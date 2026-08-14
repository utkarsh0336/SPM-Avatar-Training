import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { afterEach, describe, expect, it } from "vitest";
import { createBullMqIngestionQueue } from "./ingestion-queue.js";

// Unique per test file run: there's no vitest.config.ts in this repo, so
// test files execute in parallel by default. Sharing the real
// "knowledge-ingestion" queue name here would risk this test's job being
// raced/consumed by worker.test.ts's real running Worker, since both hit
// the same real test Redis instance.
function uniqueQueueName(): string {
  return `knowledge-ingestion-test-${randomUUID()}`;
}

const inspectionQueues: Queue[] = [];

afterEach(async () => {
  for (const queue of inspectionQueues.splice(0)) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

describe("createBullMqIngestionQueue", () => {
  it("enqueues a job with the expected name, payload, and retry options", async () => {
    const queueName = uniqueQueueName();
    const ingestionQueue = createBullMqIngestionQueue({ queueName });
    const orgId = randomUUID();
    const documentId = randomUUID();

    await ingestionQueue.enqueue(orgId, documentId);

    const inspectionQueue = new Queue(queueName, { connection: { url: "redis://localhost:6379" } });
    inspectionQueues.push(inspectionQueue);
    const jobs = await inspectionQueue.getJobs(["waiting", "delayed"]);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.name).toBe("ingest-document");
    expect(jobs[0]!.data).toEqual({ orgId, documentId });
    expect(jobs[0]!.opts.attempts).toBe(3);
    expect(jobs[0]!.opts.backoff).toEqual({ type: "exponential", delay: 2000 });
  });
});
