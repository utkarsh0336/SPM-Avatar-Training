import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, setAuthContext, withAuthContext, type EmbeddingProvider } from "@avatrain/shared";
import { createLocalFilesystemStorage, type DocumentStorage } from "../lib/document-storage.js";
import { txtParser } from "../lib/document-parsers/txt.js";
import { ingestDocument, uploadDocument, uploadNewVersion } from "./knowledge-service.js";
import { retrieveContext, toKnowledgeSources } from "./retrieval-service.js";

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

// Deterministic one-hot embeddings instead of real semantic ones: cosine
// similarity between two one-hot vectors is exactly 1 (same dimension) or
// exactly 0 (different dimensions) — makes threshold/ranking assertions
// exact instead of approximate.
function oneHotEmbeddingProvider(dimension: number): () => EmbeddingProvider {
  return () => ({
    name: "one-hot-fake",
    dimensions: 384,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(() => {
        const vector = Array(384).fill(0);
        vector[dimension] = 1;
        return vector;
      });
    },
  });
}

const APPLE_DIMENSION = 0;
const BANANA_DIMENSION = 1;

describe("retrieval-service", () => {
  let baseDir: string;
  let storage: DocumentStorage;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "avatrain-retrieval-test-"));
    storage = createLocalFilesystemStorage({ baseDir });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  async function seedIndexedDocument(
    orgId: string,
    userId: string,
    title: string,
    content: string,
    dimension: number,
  ): Promise<void> {
    const bytes = Buffer.from(content);
    const { id } = await uploadDocument(
      orgId,
      userId,
      { originalFilename: `${title}.txt`, mimeType: "text/plain", bytes },
      { storage, autoIngest: false },
    );
    await ingestDocument(orgId, id, bytes, txtParser, {
      storage,
      createEmbeddingProvider: oneHotEmbeddingProvider(dimension),
    });
  }

  it("returns [] for empty/whitespace-only query text without touching the DB", async () => {
    const { orgId } = await seedOrgAndUser("Empty Query Org");
    expect(await retrieveContext(orgId, "   ")).toEqual([]);
  });

  it("ranks the semantically matching chunk above an unrelated one, filtering the unrelated one by threshold", async () => {
    const { orgId, userId } = await seedOrgAndUser("Ranking Org");
    await seedIndexedDocument(orgId, userId, "apple-doc", "Apples are a fruit rich in fiber.", APPLE_DIMENSION);
    await seedIndexedDocument(orgId, userId, "banana-doc", "Bananas are a good source of potassium.", BANANA_DIMENSION);

    const results = await retrieveContext(orgId, "tell me about apples", undefined, {
      createEmbeddingProvider: oneHotEmbeddingProvider(APPLE_DIMENSION),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.documentTitle).toBe("apple-doc");
    expect(results[0]!.similarity).toBeCloseTo(1, 5);
  });

  it("returns both chunks, correctly ranked, when minSimilarity is lowered to include the unrelated one", async () => {
    const { orgId, userId } = await seedOrgAndUser("Ranking Org 2");
    await seedIndexedDocument(orgId, userId, "apple-doc", "Apples are a fruit rich in fiber.", APPLE_DIMENSION);
    await seedIndexedDocument(orgId, userId, "banana-doc", "Bananas are a good source of potassium.", BANANA_DIMENSION);

    const results = await retrieveContext(
      orgId,
      "tell me about apples",
      { minSimilarity: -1 },
      { createEmbeddingProvider: oneHotEmbeddingProvider(APPLE_DIMENSION) },
    );

    expect(results.map((r) => r.documentTitle)).toEqual(["apple-doc", "banana-doc"]);
    expect(results[0]!.similarity).toBeCloseTo(1, 5);
    expect(results[1]!.similarity).toBeCloseTo(0, 5);
  });

  it("respects topK", async () => {
    const { orgId, userId } = await seedOrgAndUser("TopK Org");
    for (let i = 0; i < 3; i++) {
      await seedIndexedDocument(orgId, userId, `doc-${i}`, `Content about apples number ${i}.`, APPLE_DIMENSION);
    }

    const results = await retrieveContext(
      orgId,
      "apples",
      { topK: 2, minSimilarity: -1 },
      { createEmbeddingProvider: oneHotEmbeddingProvider(APPLE_DIMENSION) },
    );

    expect(results).toHaveLength(2);
  });

  describe("version control: only the lineage's isLatest chunks are searchable", () => {
    it("excludes a superseded version's chunks even when they'd score higher than the current version's", async () => {
      const { orgId, userId } = await seedOrgAndUser("Version Retrieval Org");
      const v1bytes = Buffer.from("Apples are a fruit rich in fiber.");
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "doc.txt", mimeType: "text/plain", bytes: v1bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v1Id, v1bytes, txtParser, {
        storage,
        createEmbeddingProvider: oneHotEmbeddingProvider(APPLE_DIMENSION),
      });

      const v2bytes = Buffer.from("Bananas are a good source of potassium.");
      const v2 = await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "doc-v2.txt", mimeType: "text/plain", bytes: v2bytes },
        {},
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v2.id, v2bytes, txtParser, {
        storage,
        createEmbeddingProvider: oneHotEmbeddingProvider(BANANA_DIMENSION),
      });

      // The apple-embedding query would perfectly match v1's chunk (similarity
      // 1) — but v1 is no longer isLatest, so at a very permissive threshold
      // the only candidate left to search is v2's unrelated banana chunk,
      // which scores ~0 against an apple query. v1's chunk must never appear.
      const results = await retrieveContext(orgId, "apples", { minSimilarity: -1 }, {
        createEmbeddingProvider: oneHotEmbeddingProvider(APPLE_DIMENSION),
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.content).toBe(v2bytes.toString());
      expect(results[0]!.similarity).toBeCloseTo(0, 5);
    });

    it("keeps grounding on the prior version while a new version is still PENDING", async () => {
      const { orgId, userId } = await seedOrgAndUser("Mid Ingestion Org");
      const v1bytes = Buffer.from("Apples are a fruit rich in fiber.");
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "doc.txt", mimeType: "text/plain", bytes: v1bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v1Id, v1bytes, txtParser, {
        storage,
        createEmbeddingProvider: oneHotEmbeddingProvider(APPLE_DIMENSION),
      });

      // New version created but deliberately never ingested — stays
      // PENDING, isLatest: false.
      await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "doc-v2.txt", mimeType: "text/plain", bytes: Buffer.from("new content") },
        {},
        { storage, autoIngest: false },
      );

      const results = await retrieveContext(orgId, "apples", { minSimilarity: -1 }, {
        createEmbeddingProvider: oneHotEmbeddingProvider(APPLE_DIMENSION),
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.documentTitle).toBe("doc");
    });

    it("keeps grounding on the prior version when a re-upload fails ingestion", async () => {
      const { orgId, userId } = await seedOrgAndUser("Failed Reupload Org");
      const v1bytes = Buffer.from("Apples are a fruit rich in fiber.");
      const { id: v1Id } = await uploadDocument(
        orgId,
        userId,
        { originalFilename: "doc.txt", mimeType: "text/plain", bytes: v1bytes },
        { storage, autoIngest: false },
      );
      await ingestDocument(orgId, v1Id, v1bytes, txtParser, {
        storage,
        createEmbeddingProvider: oneHotEmbeddingProvider(APPLE_DIMENSION),
      });

      const v2bytes = Buffer.from("more content");
      const v2 = await uploadNewVersion(
        orgId,
        userId,
        v1Id,
        { originalFilename: "doc-v2.txt", mimeType: "text/plain", bytes: v2bytes },
        {},
        { storage, autoIngest: false },
      );
      const throwingProvider = (): EmbeddingProvider => ({
        name: "fake-broken",
        dimensions: 384,
        async embed(): Promise<number[][]> {
          throw new Error("embedding provider unavailable");
        },
      });
      await ingestDocument(orgId, v2.id, v2bytes, txtParser, { storage, createEmbeddingProvider: throwingProvider });

      const results = await retrieveContext(orgId, "apples", { minSimilarity: -1 }, {
        createEmbeddingProvider: oneHotEmbeddingProvider(APPLE_DIMENSION),
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.documentTitle).toBe("doc");
    });
  });

  describe("two-org isolation", () => {
    it("org A's indexed chunks are never retrievable from org B, even with a matching query embedding", async () => {
      const orgA = await seedOrgAndUser("Retrieval Isolation Org A");
      const orgB = await seedOrgAndUser("Retrieval Isolation Org B");

      await seedIndexedDocument(orgA.orgId, orgA.userId, "org-a-secret", "Org A's confidential apple strategy.", APPLE_DIMENSION);

      const resultsForB = await retrieveContext(
        orgB.orgId,
        "apples",
        { minSimilarity: -1 },
        { createEmbeddingProvider: oneHotEmbeddingProvider(APPLE_DIMENSION) },
      );

      expect(resultsForB).toEqual([]);
    });
  });
});

describe("toKnowledgeSources", () => {
  it("de-duplicates by documentId, preserving first-seen (rank) order", () => {
    const sources = toKnowledgeSources([
      { documentId: "doc-1", documentTitle: "Doc One", content: "a", similarity: 0.9 },
      { documentId: "doc-2", documentTitle: "Doc Two", content: "b", similarity: 0.8 },
      { documentId: "doc-1", documentTitle: "Doc One", content: "c", similarity: 0.7 },
    ]);

    expect(sources).toEqual([
      { documentId: "doc-1", title: "Doc One" },
      { documentId: "doc-2", title: "Doc Two" },
    ]);
  });

  it("returns [] for an empty input", () => {
    expect(toKnowledgeSources([])).toEqual([]);
  });
});
