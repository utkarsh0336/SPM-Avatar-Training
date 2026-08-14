import { Queue, Worker, type Job } from "bullmq";

/**
 * Adapter boundary for the ingestion job queue — same shape as
 * DocumentStorage/EmbeddingProvider, enforced by
 * scripts/verify-provider-boundary.mjs. This is also the *only* place
 * outside worker.ts's process entrypoint that constructs a bullmq Worker;
 * createIngestionWorker() exists specifically so worker.ts never imports
 * "bullmq" itself, keeping the boundary script's restriction real rather
 * than nominal.
 */
export const KNOWLEDGE_INGESTION_QUEUE_NAME = "knowledge-ingestion";
const JOB_NAME = "ingest-document";

export interface IngestionJobData {
  orgId: string;
  documentId: string;
}

export interface IngestionQueue {
  enqueue(orgId: string, documentId: string): Promise<void>;
}

export interface IngestionWorkerHandle {
  close(): Promise<void>;
}

function redisUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.REDIS_URL ?? "redis://localhost:6379";
}

export interface CreateBullMqIngestionQueueOptions {
  redisUrl?: string;
  /** Test-only override so parallel test files never share a queue name against the same test Redis instance. */
  queueName?: string;
}

export function createBullMqIngestionQueue(options: CreateBullMqIngestionQueueOptions = {}): IngestionQueue {
  const connection = { url: options.redisUrl ?? redisUrlFromEnv() };
  const queue = new Queue<IngestionJobData>(options.queueName ?? KNOWLEDGE_INGESTION_QUEUE_NAME, { connection });

  return {
    async enqueue(orgId: string, documentId: string): Promise<void> {
      // attempts/backoff per .claude/specs/knowledge-search-and-ingestion-queue.md's
      // Ingestion Queue Design: a transient embedding-provider hiccup
      // self-heals without trainer intervention.
      await queue.add(
        JOB_NAME,
        { orgId, documentId },
        { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
      );
    },
  };
}

// Module-level singleton — a bullmq Queue opens and holds a live Redis
// connection at construction, and uploadDocument()/uploadNewVersion() call
// createIngestionQueueFromEnv() on every request that doesn't inject
// deps.ingestionQueue (i.e. every real HTTP call) — a fresh Queue per call
// would leak a new connection per upload with nothing ever closing it.
let sharedQueue: IngestionQueue | null = null;

export function createIngestionQueueFromEnv(): IngestionQueue {
  if (!sharedQueue) sharedQueue = createBullMqIngestionQueue();
  return sharedQueue;
}

export interface CreateIngestionWorkerOptions {
  concurrency?: number;
  redisUrl?: string;
  queueName?: string;
}

export function createIngestionWorker(
  handler: (job: IngestionJobData) => Promise<void>,
  options: CreateIngestionWorkerOptions = {},
): IngestionWorkerHandle {
  const connection = { url: options.redisUrl ?? redisUrlFromEnv() };
  const worker = new Worker<IngestionJobData>(
    options.queueName ?? KNOWLEDGE_INGESTION_QUEUE_NAME,
    async (job: Job<IngestionJobData>) => {
      await handler(job.data);
    },
    { connection, concurrency: options.concurrency ?? 2 },
  );
  worker.on("failed", (job, error) => {
    console.error(
      `ingestion-queue: job ${job?.id ?? "unknown"} (document ${job?.data.documentId ?? "unknown"}) failed`,
      error,
    );
  });
  return { close: () => worker.close() };
}
