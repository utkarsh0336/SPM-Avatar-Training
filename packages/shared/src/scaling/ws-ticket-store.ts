import { Redis } from "ioredis";

/**
 * Minimal surface this module needs from ioredis — same narrowing rationale
 * as concurrency-counter.ts's ConcurrencyRedisClient.
 */
export interface TicketStoreRedisClient {
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  quit?(): Promise<unknown>;
}

export interface SingleUseTicketStore {
  /** Stores `value` under `key`, garbage-collected by Redis after `ttlMs` if never taken. */
  put(key: string, value: string, ttlMs: number): Promise<void>;
  /**
   * Atomically reads and deletes `key` in one round trip — a second call for the same key,
   * concurrent or not, gets null even if it raced the first. Returns null if the key never
   * existed, was already taken, or has expired.
   */
  takeOnce(key: string): Promise<string | null>;
  /** Closes the underlying connection. Tests close per-case; the process-lifetime shared store never needs to. */
  close(): Promise<void>;
}

export interface CreateRedisSingleUseTicketStoreOptions {
  redisUrl?: string;
  /** Injectable client for tests. Defaults to a real ioredis connection. */
  client?: TicketStoreRedisClient;
}

function redisUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.REDIS_URL ?? "redis://localhost:6379";
}

// GET-then-DEL inside one EVAL so two concurrent takeOnce() calls for the same key (across
// however many apps/api machines share this Redis — see infra/fly/api-*.toml's
// min_machines_running) can't both see a non-nil value — same atomicity technique as
// rate-limiter.ts's sliding-window script, applied to "single use" instead of "under quota."
const TAKE_ONCE_SCRIPT = `
local v = redis.call("GET", KEYS[1])
if v then
  redis.call("DEL", KEYS[1])
end
return v
`;

/**
 * Generic Redis-backed single-use, TTL'd key/value store — deliberately value-agnostic (callers
 * JSON-encode/decode their own payload) rather than ws-ticket-specific. First consumer is
 * apps/api/src/lib/ws-tickets.ts, replacing its old in-process Map for the same reason
 * checkRateLimit moved off one — see .claude/specs/distributed-ws-ticket-store.md.
 *
 * Deliberately does not catch/swallow client errors the way concurrency-counter.ts's
 * acquire()/release() do — whether a store error should fail open or closed is a policy decision
 * that depends on what the caller is using this for (an auth boundary vs. a soft quota), so it
 * belongs at the call site, not baked into this generic primitive.
 */
export function createRedisSingleUseTicketStore(
  options: CreateRedisSingleUseTicketStoreOptions = {},
): SingleUseTicketStore {
  const client: TicketStoreRedisClient =
    options.client ?? (new Redis(options.redisUrl ?? redisUrlFromEnv()) as unknown as TicketStoreRedisClient);

  return {
    async put(key, value, ttlMs) {
      await client.set(key, value, "PX", ttlMs);
    },
    async takeOnce(key) {
      const result = await client.eval(TAKE_ONCE_SCRIPT, 1, key);
      return typeof result === "string" ? result : null;
    },
    async close() {
      await client.quit?.();
    },
  };
}
