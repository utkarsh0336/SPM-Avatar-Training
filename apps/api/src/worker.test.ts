import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, setAuthContext, withAuthContext, type EmbeddingProvider } from "@avatrain/shared";
import { createLocalFilesystemStorage, type DocumentStorage } from "./lib/document-storage.js";
import { createBullMqIngestionQueue, createIngestionWorker, type IngestionWorkerHandle } from "./lib/ingestion-queue.js";
import { getDocument, ingestStoredDocument, uploadDocument } from "./services/knowledge-service.js";

// The one place this feature deliberately exercises the real queue+worker
// wiring end to end rather than mocking it away — see
// .claude/specs/knowledge-search-and-ingestion-queue.md's Testing section.
// Everything else (knowledge-service.test.ts, retrieval-service.test.ts,
// knowledge.test.ts) stays deterministic via direct ingestDocument() calls.

function uniqueQueueName(): string {
  return `knowledge-ingestion-worker-test-${randomUUID()}`;
}

function fakeEmbeddingProvider(): EmbeddingProvider {
  return {
    name: "fake",
    dimensions: 384,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(() => Array(384).fill(0.01));
    },
  };
}

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

describe("ingestion worker (real queue + real worker, end to end)", () => {
  let baseDir: string;
  let storage: DocumentStorage;
  let workerHandle: IngestionWorkerHandle | undefined;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "avatrain-worker-test-"));
    storage = createLocalFilesystemStorage({ baseDir });
  });

  afterEach(async () => {
    await workerHandle?.close();
    workerHandle = undefined;
    await rm(baseDir, { recursive: true, force: true });
  });

  it("processes an enqueued job and brings the document to INDEXED", async () => {
    const { orgId, userId } = await seedOrgAndUser("Worker Integration Org");
    const queueName = uniqueQueueName();
    const bytes = Buffer.from("word ".repeat(500).trim());

    // Created with autoIngest: false — this test drives enqueue/process
    // itself via a test-scoped queue name, not the shared production one,
    // so it never races other test files hitting the same real Redis.
    const { id: documentId } = await uploadDocument(
      orgId,
      userId,
      { originalFilename: "policy.txt", mimeType: "text/plain", bytes },
      { storage, autoIngest: false },
    );

    workerHandle = createIngestionWorker(
      async (job) => {
        await ingestStoredDocument(job.orgId, job.documentId, {
          storage,
          createEmbeddingProvider: fakeEmbeddingProvider,
        });
      },
      { queueName },
    );

    const queue = createBullMqIngestionQueue({ queueName });
    await queue.enqueue(orgId, documentId);

    await expect
      .poll(async () => (await getDocument(orgId, documentId)).status, { timeout: 10000, interval: 100 })
      .toBe("INDEXED");

    const doc = await getDocument(orgId, documentId);
    expect(doc.chunkCount).toBeGreaterThan(0);
    expect(doc.isLatest).toBe(true);
  });
});
