import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, setAuthContext, withAuthContext, type EmbeddingProvider } from "@avatrain/shared";
import { createLocalFilesystemStorage, type DocumentStorage } from "../lib/document-storage.js";
import { txtParser } from "../lib/document-parsers/txt.js";
import {
  deleteDocument,
  getDocument,
  ingestDocument,
  listDocuments,
  uploadDocument,
} from "./knowledge-service.js";

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const orgId of createdOrgIds) {
    await withAuthContext({ orgId }, async (tx) => {
      await tx.knowledgeDocument.deleteMany({ where: { orgId } });
      await tx.membership.deleteMany({ where: { orgId } });
    });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  for (const orgId of createdOrgIds) {
    await prisma.organization.deleteMany({ where: { id: orgId } });
  }
}

afterAll(cleanup);

async function seedOrgAndUser(label: string): Promise<{ orgId: string; userId: string }> {
  const orgId = randomUUID();
  const userId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: label } });
    await tx.user.create({
      data: { id: userId, email: `${label}-${randomUUID()}@example.com`, passwordHash: "seeded" },
    });
    await setAuthContext(tx, { userId, orgId });
    await tx.membership.create({ data: { orgId, userId, role: "OWNER" } });
  });
  createdOrgIds.push(orgId);
  createdUserIds.push(userId);
  return { orgId, userId };
}

// 384-dim to satisfy KnowledgeChunk.embedding's vector(384) column — exact
// values don't matter for these tests (status/chunkCount transitions, not
// retrieval quality; see retrieval-service.test.ts for that).
function fakeEmbeddingProvider(): EmbeddingProvider {
  return {
    name: "fake",
    dimensions: 384,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(() => Array(384).fill(0.01));
    },
  };
}

function throwingEmbeddingProvider(): EmbeddingProvider {
  return {
    name: "fake-broken",
    dimensions: 384,
    async embed(): Promise<number[][]> {
      throw new Error("embedding provider unavailable");
    },
  };
}

describe("knowledge-service", () => {
  let baseDir: string;
  let storage: DocumentStorage;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "avatrain-knowledge-service-test-"));
    storage = createLocalFilesystemStorage({ baseDir });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  describe("uploadDocument", () => {
    it("rejects an unsupported mime type", async () => {
      const { orgId, userId } = await seedOrgAndUser("Unsupported Mime Org");
      await expect(
        uploadDocument(
          orgId,
          userId,
          { originalFilename: "deck.pptx", mimeType: "application/vnd.ms-powerpoint", bytes: Buffer.from("x") },
          { storage, autoIngest: false },
        ),
      ).rejects.toMatchObject({ statusCode: 400, code: "unsupported_mime_type" });
    });

    it("rejects a file over the size cap", async () => {
      const { orgId, userId } = await seedOrgAndUser("Oversized Org");
      const tooBig = Buffer.alloc(26 * 1024 * 1024);
      await expect(
        uploadDocument(
          orgId,
          userId,
          { originalFilename: "big.txt", mimeType: "text/plain", bytes: tooBig },
          { storage, autoIngest: false },
        ),
      ).rejects.toMatchObject({ statusCode: 400, code: "file_too_large" });
    });

    it("creates a PENDING document immediately, deriving title from the filename", async () => {
      const { orgId, userId } = await seedOrgAndUser("Pending Org");
      const result = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "leave-policy.txt", mimeType: "text/plain", bytes: Buffer.from("hello") },
        { storage, autoIngest: false },
      );

      expect(result.status).toBe("PENDING");
      const doc = await getDocument(orgId, result.id);
      expect(doc.title).toBe("leave-policy");
      expect(doc.originalFilename).toBe("leave-policy.txt");
    });
  });

  describe("ingestDocument", () => {
    it("indexes a text document end to end: PENDING -> PROCESSING -> INDEXED with chunks", async () => {
      const { orgId, userId } = await seedOrgAndUser("Ingest Org");
      const bytes = Buffer.from("word ".repeat(500).trim());
      const { id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "policy.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );

      await ingestDocument(orgId, id, bytes, txtParser, { storage, createEmbeddingProvider: fakeEmbeddingProvider });

      const doc = await getDocument(orgId, id);
      expect(doc.status).toBe("INDEXED");
      expect(doc.chunkCount).toBeGreaterThan(0);
      expect(doc.errorMessage).toBeNull();
    });

    it("marks the document FAILED with a message when the embedding provider throws", async () => {
      const { orgId, userId } = await seedOrgAndUser("Ingest Fail Org");
      const bytes = Buffer.from("some content to embed");
      const { id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "policy.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );

      await ingestDocument(orgId, id, bytes, txtParser, {
        storage,
        createEmbeddingProvider: throwingEmbeddingProvider,
      });

      const doc = await getDocument(orgId, id);
      expect(doc.status).toBe("FAILED");
      expect(doc.errorMessage).toContain("embedding provider unavailable");
    });

    it("marks the document FAILED when the source has no extractable text", async () => {
      const { orgId, userId } = await seedOrgAndUser("Ingest Empty Org");
      const bytes = Buffer.from("   \n\t  ");
      const { id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "empty.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );

      await ingestDocument(orgId, id, bytes, txtParser, { storage, createEmbeddingProvider: fakeEmbeddingProvider });

      const doc = await getDocument(orgId, id);
      expect(doc.status).toBe("FAILED");
      expect(doc.errorMessage).toMatch(/no extractable text/);
    });
  });

  describe("listDocuments / getDocument / deleteDocument", () => {
    it("lists only the calling org's documents, newest first", async () => {
      const { orgId, userId } = await seedOrgAndUser("List Org");
      await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes: Buffer.from("a") },
        { storage, autoIngest: false },
      );
      await uploadDocument(
        orgId,
        userId,
        { originalFilename: "b.txt", mimeType: "text/plain", bytes: Buffer.from("b") },
        { storage, autoIngest: false },
      );

      const docs = await listDocuments(orgId);
      expect(docs).toHaveLength(2);
      expect(docs[0]!.createdAt >= docs[1]!.createdAt).toBe(true);
    });

    it("getDocument throws not_found for a document belonging to a different org", async () => {
      const orgA = await seedOrgAndUser("Get NotFound Org A");
      const orgB = await seedOrgAndUser("Get NotFound Org B");
      const { id } = await uploadDocument(
        orgA.orgId,
        orgA.userId,
        { originalFilename: "secret.txt", mimeType: "text/plain", bytes: Buffer.from("secret") },
        { storage, autoIngest: false },
      );

      await expect(getDocument(orgB.orgId, id)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("deleteDocument removes the row and the stored file", async () => {
      const { orgId, userId } = await seedOrgAndUser("Delete Org");
      const { id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "to-delete.txt", mimeType: "text/plain", bytes: Buffer.from("bye") },
        { storage, autoIngest: false },
      );

      await deleteDocument(orgId, id, { storage });

      await expect(getDocument(orgId, id)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("deleteDocument throws not_found for another org's document", async () => {
      const orgA = await seedOrgAndUser("Delete NotFound Org A");
      const orgB = await seedOrgAndUser("Delete NotFound Org B");
      const { id } = await uploadDocument(
        orgA.orgId,
        orgA.userId,
        { originalFilename: "secret.txt", mimeType: "text/plain", bytes: Buffer.from("secret") },
        { storage, autoIngest: false },
      );

      await expect(deleteDocument(orgB.orgId, id, { storage })).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
