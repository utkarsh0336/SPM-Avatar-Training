import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedisRateLimiter, type RateLimiter, type RateLimitRedisClient } from "./rate-limiter.js";

// Unique per test: there's no vitest.config.ts in this repo, so test files
// run in parallel by default against one real Redis. Same reasoning as
// concurrency-counter.test.ts's uniqueKey().
function uniqueKey(): string {
  return `ratelimit-test-${randomUUID()}`;
}

const limiters: RateLimiter[] = [];
afterEach(async () => {
  for (const limiter of limiters.splice(0)) {
    await limiter.close();
  }
});

describe("createRedisRateLimiter", () => {
  it("allows up to max attempts within the window, then rejects", async () => {
    const limiter = createRedisRateLimiter();
    limiters.push(limiter);
    const key = uniqueKey();

    expect(await limiter.check(key, { max: 3, windowMs: 60_000 })).toBe(true);
    expect(await limiter.check(key, { max: 3, windowMs: 60_000 })).toBe(true);
    expect(await limiter.check(key, { max: 3, windowMs: 60_000 })).toBe(true);
    expect(await limiter.check(key, { max: 3, windowMs: 60_000 })).toBe(false);
  });

  it("tracks different keys independently", async () => {
    const limiter = createRedisRateLimiter();
    limiters.push(limiter);
    const keyA = uniqueKey();
    const keyB = uniqueKey();

    expect(await limiter.check(keyA, { max: 1, windowMs: 60_000 })).toBe(true);
    expect(await limiter.check(keyA, { max: 1, windowMs: 60_000 })).toBe(false);
    expect(await limiter.check(keyB, { max: 1, windowMs: 60_000 })).toBe(true);
  });

  it("lets attempts back in once they age out of the window", async () => {
    let now = 1_000_000;
    const limiter = createRedisRateLimiter({ now: () => now });
    limiters.push(limiter);
    const key = uniqueKey();

    expect(await limiter.check(key, { max: 1, windowMs: 5_000 })).toBe(true);
    expect(await limiter.check(key, { max: 1, windowMs: 5_000 })).toBe(false);

    now = 1_005_001; // past the window
    expect(await limiter.check(key, { max: 1, windowMs: 5_000 })).toBe(true);
  });

  it("fails open on a broken client instead of throwing or blocking traffic", async () => {
    const brokenClient: RateLimitRedisClient = {
      eval: vi.fn().mockRejectedValue(new Error("connection refused")),
    };
    const limiter = createRedisRateLimiter({ client: brokenClient });
    limiters.push(limiter);

    await expect(limiter.check(uniqueKey(), { max: 1, windowMs: 60_000 })).resolves.toBe(true);
  });
});
