import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@avatrain/shared";
import { createUptimeRetentionQueue, createUptimeRetentionWorker } from "./uptime-retention-job.js";

// Unique per test — same reasoning as ingestion-queue.test.ts: no
// vitest.config.ts means test files run in parallel against one real Redis.
function uniqueQueueName(): string {
  return `uptime-retention-test-${randomUUID()}`;
}

const inspectionQueues: Queue[] = [];
const createdCheckServices: string[] = [];

afterEach(async () => {
  for (const queue of inspectionQueues.splice(0)) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
  if (createdCheckServices.length > 0) {
    await prisma.uptimeCheck.deleteMany({ where: { service: { in: createdCheckServices.splice(0) } } });
  }
});

describe("createUptimeRetentionQueue", () => {
  it("upserts a daily job scheduler, idempotently", async () => {
    const queueName = uniqueQueueName();
    const queue = createUptimeRetentionQueue({ queueName });

    await queue.ensureScheduled();
    await queue.ensureScheduled(); // second call must not duplicate the schedule

    const inspectionQueue = new Queue(queueName, { connection: { url: "redis://localhost:6379" } });
    inspectionQueues.push(inspectionQueue);
    const schedulers = await inspectionQueue.getJobSchedulers();

    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]!.pattern).toBe("0 3 * * *");
  });
});

describe("createUptimeRetentionWorker", () => {
  it("deletes checks older than the retention window and keeps recent ones", async () => {
    const service = `retention-test-${randomUUID()}`;
    createdCheckServices.push(service);

    const old = await prisma.uptimeCheck.create({
      data: {
        region: "US",
        service,
        status: "UP",
        checkedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
      },
    });
    const recent = await prisma.uptimeCheck.create({
      data: { region: "US", service, status: "UP" },
    });

    const queueName = uniqueQueueName();
    const worker = createUptimeRetentionWorker({ queueName });
    try {
      const queue = new Queue(queueName, { connection: { url: "redis://localhost:6379" } });
      inspectionQueues.push(queue);
      await queue.add("prune-uptime-checks", {});

      // Poll DB state directly rather than job.waitUntilFinished() — that
      // needs a QueueEvents listener this test doesn't otherwise use.
      await expect
        .poll(async () => prisma.uptimeCheck.findUnique({ where: { id: old.id } }), { timeout: 5000, interval: 100 })
        .toBeNull();

      const stillThere = await prisma.uptimeCheck.findUnique({ where: { id: recent.id } });
      expect(stillThere).not.toBeNull();
    } finally {
      await worker.close();
    }
  });
});
