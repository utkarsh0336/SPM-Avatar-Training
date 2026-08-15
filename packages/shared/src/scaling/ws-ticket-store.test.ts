import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRedisSingleUseTicketStore, type SingleUseTicketStore, type TicketStoreRedisClient } from "./ws-ticket-store.js";

// Unique per test: there's no vitest.config.ts in this repo, so test files run in parallel by
// default against one real Redis — same reasoning as concurrency-counter.test.ts's uniqueKey().
// Unlike the rate-limiter's IP-keyed buckets, every key here is naturally unique per test already
// (a random UUID), so no cross-test pooling risk even without this, but keeping the convention
// makes the intent explicit.
function uniqueKey(): string {
  return `ws-ticket-store-test-${randomUUID()}`;
}

const stores: SingleUseTicketStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) {
    await store.close();
  }
});

describe("createRedisSingleUseTicketStore", () => {
  it("put() then takeOnce() returns the stored value", async () => {
    const store = createRedisSingleUseTicketStore();
    stores.push(store);
    const key = uniqueKey();

    await store.put(key, "hello", 60_000);
    expect(await store.takeOnce(key)).toBe("hello");
  });

  it("is single-use — a second takeOnce() for the same key returns null", async () => {
    const store = createRedisSingleUseTicketStore();
    stores.push(store);
    const key = uniqueKey();

    await store.put(key, "hello", 60_000);
    await store.takeOnce(key);
    expect(await store.takeOnce(key)).toBeNull();
  });

  it("takeOnce() on an unknown key returns null", async () => {
    const store = createRedisSingleUseTicketStore();
    stores.push(store);

    expect(await store.takeOnce(uniqueKey())).toBeNull();
  });

  it("takeOnce() rejects a key put by a different store instance sharing the same Redis — simulates two machines", async () => {
    const storeA = createRedisSingleUseTicketStore();
    const storeB = createRedisSingleUseTicketStore();
    stores.push(storeA, storeB);
    const key = uniqueKey();

    await storeA.put(key, "minted-on-machine-a", 60_000);
    expect(await storeB.takeOnce(key)).toBe("minted-on-machine-a");
  });

  it("propagates a broken client's errors rather than swallowing them — policy is the caller's decision", async () => {
    const brokenClient: TicketStoreRedisClient = {
      set: vi.fn().mockRejectedValue(new Error("connection refused")),
      eval: vi.fn().mockRejectedValue(new Error("connection refused")),
    };
    const store = createRedisSingleUseTicketStore({ client: brokenClient });
    stores.push(store);

    await expect(store.put(uniqueKey(), "x", 1_000)).rejects.toThrow("connection refused");
    await expect(store.takeOnce(uniqueKey())).rejects.toThrow("connection refused");
  });
});
