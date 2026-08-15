import { Queue, Worker, type Job } from "bullmq";
import { prisma } from "@avatrain/shared";

export const UPTIME_RETENTION_QUEUE_NAME = "uptime-retention";
const JOB_NAME = "prune-uptime-checks";
const SCHEDULER_ID = "uptime-retention-daily";
const RETENTION_DAYS = 90;

export interface UptimeRetentionQueue {
  /** Idempotent — safe to call on every boot. Upserts the daily schedule rather than re-adding it. */
  ensureScheduled(): Promise<void>;
}

export interface UptimeRetentionWorkerHandle {
  close(): Promise<void>;
}

function redisUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.REDIS_URL ?? "redis://localhost:6379";
}

export interface CreateUptimeRetentionQueueOptions {
  redisUrl?: string;
  queueName?: string;
}

/**
 * First repeatable BullMQ job in this codebase — apps/api/src/lib/
 * ingestion-queue.ts's Queue/Worker never repeats, one job per upload.
 * upsertJobScheduler (not the older `repeat` add-time option) so re-running
 * ensureScheduled() on every boot updates rather than duplicates the
 * schedule — see BullMQ's job-scheduler docs.
 */
export function createUptimeRetentionQueue(options: CreateUptimeRetentionQueueOptions = {}): UptimeRetentionQueue {
  const connection = { url: options.redisUrl ?? redisUrlFromEnv() };
  const queue = new Queue(options.queueName ?? UPTIME_RETENTION_QUEUE_NAME, { connection });

  return {
    async ensureScheduled(): Promise<void> {
      await queue.upsertJobScheduler(
        SCHEDULER_ID,
        { pattern: "0 3 * * *" }, // daily at 03:00 — off any customer-facing traffic pattern
        { name: JOB_NAME },
      );
    },
  };
}

export interface CreateUptimeRetentionWorkerOptions {
  redisUrl?: string;
  queueName?: string;
}

export function createUptimeRetentionWorker(
  options: CreateUptimeRetentionWorkerOptions = {},
): UptimeRetentionWorkerHandle {
  const connection = { url: options.redisUrl ?? redisUrlFromEnv() };
  const worker = new Worker(
    options.queueName ?? UPTIME_RETENTION_QUEUE_NAME,
    async (_job: Job) => {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      await prisma.uptimeCheck.deleteMany({ where: { checkedAt: { lt: cutoff } } });
    },
    { connection },
  );
  worker.on("failed", (job, error) => {
    console.error(`uptime-retention-job: job ${job?.id ?? "unknown"} failed`, error);
  });
  return { close: () => worker.close() };
}
