import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedisConcurrencyCounter, type ConcurrencyRedisClient } from "./concurrency-counter.js";

// Unique per test: there's no vitest.config.ts in this repo, so test files
// run in parallel by default. A shared key against the same real test
// Redis instance would let concurrent test files race each other's
// acquire()/release() calls — same reasoning as
// apps/api/src/lib/ingestion-queue.test.ts's uniqueQueueName().
function uniqueKey(): string {
  return `avatrain:sessions:active:test-${randomUUID()}`;
}

const counters: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const counter of counters.splice(0)) {
    await counter.close();
  }
});

describe("createRedisConcurrencyCounter", () => {
  it("counts acquired sessions and excludes released ones", async () => {
    const counter = createRedisConcurrencyCounter({ key: uniqueKey() });
    counters.push(counter);

    await counter.acquire("session-a", 60_000);
    await counter.acquire("session-b", 60_000);
    expect(await counter.count()).toBe(2);

    await counter.release("session-a");
    expect(await counter.count()).toBe(1);
  });

  it("release() is a no-op when the session was never acquired", async () => {
    const counter = createRedisConcurrencyCounter({ key: uniqueKey() });
    counters.push(counter);

    await expect(counter.release("never-acquired")).resolves.toBeUndefined();
    expect(await counter.count()).toBe(0);
  });

  it("sweeps expired entries out of count() — a crashed worker's session self-heals", async () => {
    let now = 1_000_000;
    const counter = createRedisConcurrencyCounter({ key: uniqueKey(), now: () => now });
    counters.push(counter);

    await counter.acquire("short-lived", 5_000); // expires at 1_005_000, never released
    expect(await counter.count()).toBe(1);

    now = 1_005_001; // past the TTL — simulates a worker that crashed instead of calling release()
    expect(await counter.count()).toBe(0);
  });

  it("acquire()/release() fail open on a broken client instead of throwing", async () => {
    const brokenClient: ConcurrencyRedisClient = {
      zadd: vi.fn().mockRejectedValue(new Error("connection refused")),
      zrem: vi.fn().mockRejectedValue(new Error("connection refused")),
      zremrangebyscore: vi.fn(),
      zcard: vi.fn(),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    const counter = createRedisConcurrencyCounter({ client: brokenClient });
    counters.push(counter);

    await expect(counter.acquire("x", 1_000)).resolves.toBeUndefined();
    await expect(counter.release("x")).resolves.toBeUndefined();
  });

  it("count() rejects on a broken client instead of silently reporting zero load", async () => {
    const brokenClient: ConcurrencyRedisClient = {
      zadd: vi.fn(),
      zrem: vi.fn(),
      zremrangebyscore: vi.fn().mockRejectedValue(new Error("connection refused")),
      zcard: vi.fn(),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    const counter = createRedisConcurrencyCounter({ client: brokenClient });
    counters.push(counter);

    await expect(counter.count()).rejects.toThrow("connection refused");
  });
});
