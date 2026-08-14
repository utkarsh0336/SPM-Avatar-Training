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
  listVersions,
  restoreVersion,
  updateDocumentMetadata,
  uploadDocument,
  uploadNewVersion,
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

  describe("category/tags", () => {
    it("persists category and tags from the upload input", async () => {
      const { orgId, userId } = await seedOrgAndUser("Category Org");
      const { id } = await uploadDocument(
        orgId,
        userId,
        {
          originalFilename: "handbook.txt",
          mimeType: "text/plain",
          bytes: Buffer.from("hello"),
          category: "HR",
          tags: ["policy", "onboarding"],
        },
        { storage, autoIngest: false },
      );

      const doc = await getDocument(orgId, id);
      expect(doc.category).toBe("HR");
      expect(doc.tags).toEqual(["policy", "onboarding"]);
      expect(doc.version).toBe(1);
      expect(doc.isLatest).toBe(true);
    });

    it("defaults category to null and tags to [] when omitted", async () => {
      const { orgId, userId } = await seedOrgAndUser("No Category Org");
      const { id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes: Buffer.from("a") },
        { storage, autoIngest: false },
      );

      const doc = await getDocument(orgId, id);
      expect(doc.category).toBeNull();
      expect(doc.tags).toEqual([]);
    });
  });

  describe("updateDocumentMetadata", () => {
    it("sets category without clearing tags, and vice versa", async () => {
      const { orgId, userId } = await seedOrgAndUser("Metadata Org");
      const { id } = await uploadDocument(
        orgId,
        userId,
        {
          originalFilename: "a.txt",
          mimeType: "text/plain",
          bytes: Buffer.from("a"),
          category: "HR",
          tags: ["policy"],
        },
        { storage, autoIngest: false },
      );

      const afterTagUpdate = await updateDocumentMetadata(orgId, id, { tags: ["policy", "2026"] });
      expect(afterTagUpdate.category).toBe("HR");
      expect(afterTagUpdate.tags).toEqual(["policy", "2026"]);

      const afterCategoryUpdate = await updateDocumentMetadata(orgId, id, { category: "Compliance" });
      expect(afterCategoryUpdate.category).toBe("Compliance");
      expect(afterCategoryUpdate.tags).toEqual(["policy", "2026"]);
    });

    it("clears category with an explicit null", async () => {
      const { orgId, userId } = await seedOrgAndUser("Metadata Clear Org");
      const { id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes: Buffer.from("a"), category: "HR" },
        { storage, autoIngest: false },
      );

      const updated = await updateDocumentMetadata(orgId, id, { category: null });
      expect(updated.category).toBeNull();
    });

    it("throws not_found for another org's document", async () => {
      const orgA = await seedOrgAndUser("Metadata NotFound Org A");
      const orgB = await seedOrgAndUser("Metadata NotFound Org B");
      const { id } = await uploadDocument(
        orgA.orgId,
        orgA.userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes: Buffer.from("a") },
        { storage, autoIngest: false },
      );

      await expect(updateDocumentMetadata(orgB.orgId, id, { category: "x" })).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe("listDocuments: highest-version-per-lineage + filtering", () => {
    it("returns only the highest-version row per lineage", async () => {
      const { orgId, userId } = await seedOrgAndUser("List Lineage Org");
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes: Buffer.from("a") },
        { storage, autoIngest: false },
      );
      await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "a2.txt", mimeType: "text/plain", bytes: Buffer.from("a2") },
        {},
        { storage, autoIngest: false },
      );

      const docs = await listDocuments(orgId);
      expect(docs).toHaveLength(1);
      expect(docs[0]!.version).toBe(2);
    });

    it("filters by exact category", async () => {
      const { orgId, userId } = await seedOrgAndUser("Filter Category Org");
      await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes: Buffer.from("a"), category: "HR" },
        { storage, autoIngest: false },
      );
      await uploadDocument(
        orgId,
        userId,
        { originalFilename: "b.txt", mimeType: "text/plain", bytes: Buffer.from("b"), category: "Legal" },
        { storage, autoIngest: false },
      );

      const docs = await listDocuments(orgId, { category: "HR" });
      expect(docs).toHaveLength(1);
      expect(docs[0]!.category).toBe("HR");
    });

    it("filters by tags with ANY-of semantics", async () => {
      const { orgId, userId } = await seedOrgAndUser("Filter Tags Org");
      await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes: Buffer.from("a"), tags: ["policy"] },
        { storage, autoIngest: false },
      );
      await uploadDocument(
        orgId,
        userId,
        { originalFilename: "b.txt", mimeType: "text/plain", bytes: Buffer.from("b"), tags: ["sales"] },
        { storage, autoIngest: false },
      );
      await uploadDocument(
        orgId,
        userId,
        { originalFilename: "c.txt", mimeType: "text/plain", bytes: Buffer.from("c"), tags: ["policy", "sales"] },
        { storage, autoIngest: false },
      );

      const docs = await listDocuments(orgId, { tags: ["policy"] });
      expect(docs).toHaveLength(2);
      expect(docs.every((d) => d.tags.includes("policy"))).toBe(true);
    });
  });

  describe("uploadNewVersion", () => {
    it("creates the next version in the same lineage, isLatest: false until ingested", async () => {
      const { orgId, userId } = await seedOrgAndUser("New Version Org");
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        {
          originalFilename: "handbook.txt",
          mimeType: "text/plain",
          bytes: Buffer.from("hello"),
          category: "HR",
          tags: ["policy"],
        },
        { storage, autoIngest: false },
      );

      const v2 = await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "handbook-v2.txt", mimeType: "text/plain", bytes: Buffer.from("hello v2") },
        {},
        { storage, autoIngest: false },
      );

      expect(v2.version).toBe(2);
      const v2doc = await getDocument(orgId, v2.id);
      expect(v2doc.isLatest).toBe(false);
      expect(v2doc.title).toBe("handbook");
      expect(v2doc.category).toBe("HR");
      expect(v2doc.tags).toEqual(["policy"]);
    });

    it("uses an explicit title override instead of inheriting", async () => {
      const { orgId, userId } = await seedOrgAndUser("Title Override Org");
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "handbook.txt", mimeType: "text/plain", bytes: Buffer.from("hello") },
        { storage, autoIngest: false },
      );

      const v2 = await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "handbook-v2.txt", mimeType: "text/plain", bytes: Buffer.from("hello v2") },
        { title: "Employee Handbook 2026" },
        { storage, autoIngest: false },
      );

      expect((await getDocument(orgId, v2.id)).title).toBe("Employee Handbook 2026");
    });

    it("throws not_found for a document belonging to a different org", async () => {
      const orgA = await seedOrgAndUser("Version NotFound Org A");
      const orgB = await seedOrgAndUser("Version NotFound Org B");
      const { id } = await uploadDocument(
        orgA.orgId,
        orgA.userId,
        { originalFilename: "secret.txt", mimeType: "text/plain", bytes: Buffer.from("secret") },
        { storage, autoIngest: false },
      );

      await expect(
        uploadNewVersion(
          orgB.orgId,
          orgB.userId,
          id,
          { originalFilename: "x.txt", mimeType: "text/plain", bytes: Buffer.from("x") },
          {},
          { storage, autoIngest: false },
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("listVersions", () => {
    it("lists all versions in a lineage, newest first", async () => {
      const { orgId, userId } = await seedOrgAndUser("List Versions Org");
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes: Buffer.from("a") },
        { storage, autoIngest: false },
      );
      const v2 = await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "a2.txt", mimeType: "text/plain", bytes: Buffer.from("a2") },
        {},
        { storage, autoIngest: false },
      );

      const versions = await listVersions(orgId, v1Id);
      expect(versions.map((v) => v.version)).toEqual([2, 1]);
      expect(versions[0]!.id).toBe(v2.id);
    });
  });

  describe("ingestDocument: isLatest only flips on success", () => {
    it("keeps the prior version grounded through a failed re-upload, then flips on a successful one", async () => {
      const { orgId, userId } = await seedOrgAndUser("Version Flip Org");
      const bytes = Buffer.from("word ".repeat(500).trim());
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "policy.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v1Id, bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });
      expect((await getDocument(orgId, v1Id)).isLatest).toBe(true);

      const failBytes = Buffer.from("word ".repeat(500).trim());
      const failed = await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "policy-v2.txt", mimeType: "text/plain", bytes: failBytes },
        {},
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, failed.id, failBytes, txtParser, {
        storage,
        createEmbeddingProvider: throwingEmbeddingProvider,
      });
      expect((await getDocument(orgId, failed.id)).status).toBe("FAILED");
      expect((await getDocument(orgId, failed.id)).isLatest).toBe(false);
      expect((await getDocument(orgId, v1Id)).isLatest).toBe(true);

      const succeedBytes = Buffer.from("word ".repeat(500).trim());
      const succeeded = await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "policy-v3.txt", mimeType: "text/plain", bytes: succeedBytes },
        {},
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, succeeded.id, succeedBytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });
      expect(succeeded.version).toBe(3);
      expect((await getDocument(orgId, succeeded.id)).isLatest).toBe(true);
      expect((await getDocument(orgId, v1Id)).isLatest).toBe(false);
    });
  });

  describe("restoreVersion", () => {
    it("restores an older INDEXED version as the lineage's active version", async () => {
      const { orgId, userId } = await seedOrgAndUser("Restore Org");
      const bytes = Buffer.from("word ".repeat(500).trim());
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v1Id, bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });

      const v2bytes = Buffer.from("word ".repeat(500).trim());
      const v2 = await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "a2.txt", mimeType: "text/plain", bytes: v2bytes },
        {},
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v2.id, v2bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });
      expect((await getDocument(orgId, v2.id)).isLatest).toBe(true);
      // v1 was superseded — setLatestVersion() deleted its chunks; a stale
      // chunkCount would mean the invariant retrieval-service.ts relies on
      // (knowledge_chunks only ever holds the lineage's current isLatest
      // document's rows) isn't actually being enforced.
      expect((await getDocument(orgId, v1Id)).chunkCount).toBe(0);

      // Restoring re-ingests from v1's stored file (its chunks are gone,
      // not just flagged) — requires an embedding provider, unlike a bare
      // flag flip.
      const restored = await restoreVersion(orgId, v1Id, v1Id, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });
      expect(restored.isLatest).toBe(true);
      expect(restored.chunkCount).toBeGreaterThan(0);
      const v2After = await getDocument(orgId, v2.id);
      expect(v2After.isLatest).toBe(false);
      expect(v2After.chunkCount).toBe(0);
    });

    it("is a no-op that skips re-ingestion when the target is already isLatest", async () => {
      const { orgId, userId } = await seedOrgAndUser("Restore Noop Org");
      const bytes = Buffer.from("word ".repeat(500).trim());
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v1Id, bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });

      // No createEmbeddingProvider override — if this attempted
      // re-ingestion it would fall through to the real env-configured
      // provider and either hang/slow this test or throw; passing with a
      // bare `{}` deps object proves the already-isLatest short-circuit
      // returned without calling ingestDocument() at all.
      const restored = await restoreVersion(orgId, v1Id, v1Id, {});
      expect(restored.isLatest).toBe(true);
      expect(restored.chunkCount).toBeGreaterThan(0);
    });

    it("returns 409 and does not mutate isLatest when restoring a non-INDEXED version", async () => {
      const { orgId, userId } = await seedOrgAndUser("Restore Conflict Org");
      const bytes = Buffer.from("word ".repeat(500).trim());
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v1Id, bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });

      const v2bytes = Buffer.from("word ".repeat(500).trim());
      const v2 = await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "a2.txt", mimeType: "text/plain", bytes: v2bytes },
        {},
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v2.id, v2bytes, txtParser, {
        storage,
        createEmbeddingProvider: throwingEmbeddingProvider,
      });
      expect((await getDocument(orgId, v2.id)).status).toBe("FAILED");

      await expect(restoreVersion(orgId, v1Id, v2.id)).rejects.toMatchObject({
        statusCode: 409,
        code: "version_not_restorable",
      });
      expect((await getDocument(orgId, v1Id)).isLatest).toBe(true);
      expect((await getDocument(orgId, v2.id)).isLatest).toBe(false);
    });

    it("throws not_found when the target version isn't in the document's lineage", async () => {
      const { orgId, userId } = await seedOrgAndUser("Restore Cross Lineage Org");
      const bytes = Buffer.from("word ".repeat(500).trim());
      const { id: docAId } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, docAId, bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });
      const { id: docBId } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "b.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, docBId, bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });

      await expect(restoreVersion(orgId, docAId, docBId)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("throws not_found for another org's document/version", async () => {
      const orgA = await seedOrgAndUser("Restore NotFound Org A");
      const orgB = await seedOrgAndUser("Restore NotFound Org B");
      const bytes = Buffer.from("word ".repeat(500).trim());
      const { id } = await uploadDocument(
        orgA.orgId,
        orgA.userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgA.orgId, id, bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });

      await expect(restoreVersion(orgB.orgId, id, id)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("deleteDocument: promote-next-version", () => {
    it("promotes the next highest INDEXED version when the active version is deleted", async () => {
      const { orgId, userId } = await seedOrgAndUser("Delete Promote Org");
      const bytes = Buffer.from("word ".repeat(500).trim());
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v1Id, bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });

      const v2bytes = Buffer.from("word ".repeat(500).trim());
      const v2 = await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "a2.txt", mimeType: "text/plain", bytes: v2bytes },
        {},
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v2.id, v2bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });
      expect((await getDocument(orgId, v2.id)).isLatest).toBe(true);
      expect((await getDocument(orgId, v1Id)).chunkCount).toBe(0);

      // Promotion re-ingests v1 from its stored file (its chunks were
      // deleted when v2 superseded it) — needs an embedding provider, same
      // reason as restoreVersion().
      await deleteDocument(orgId, v2.id, { storage, createEmbeddingProvider: fakeEmbeddingProvider });

      const v1After = await getDocument(orgId, v1Id);
      expect(v1After.isLatest).toBe(true);
      expect(v1After.chunkCount).toBeGreaterThan(0);
    });

    it("leaves the lineage with no remaining row when its only version is deleted", async () => {
      const { orgId, userId } = await seedOrgAndUser("Delete No Remaining Org");
      const bytes = Buffer.from("word ".repeat(500).trim());
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v1Id, bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });

      await deleteDocument(orgId, v1Id, { storage });

      await expect(getDocument(orgId, v1Id)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("does not touch isLatest when deleting a non-latest version", async () => {
      const { orgId, userId } = await seedOrgAndUser("Delete NonLatest Org");
      const bytes = Buffer.from("word ".repeat(500).trim());
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "a.txt", mimeType: "text/plain", bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v1Id, bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });
      const v2bytes = Buffer.from("word ".repeat(500).trim());
      const v2 = await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "a2.txt", mimeType: "text/plain", bytes: v2bytes },
        {},
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v2.id, v2bytes, txtParser, {
        storage,
        createEmbeddingProvider: fakeEmbeddingProvider,
      });

      await deleteDocument(orgId, v1Id, { storage });

      expect((await getDocument(orgId, v2.id)).isLatest).toBe(true);
    });
  });
});
