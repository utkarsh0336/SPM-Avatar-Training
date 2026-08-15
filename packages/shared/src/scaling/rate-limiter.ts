import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
}

/**
 * Minimal surface this module needs from ioredis — same narrowing rationale
 * as concurrency-counter.ts's ConcurrencyRedisClient: tests (or any future
 * non-ioredis backend) only have to satisfy one method.
 */
export interface RateLimitRedisClient {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  quit?(): Promise<unknown>;
}

export interface RateLimiter {
  check(key: string, options?: RateLimitOptions): Promise<boolean>;
  /** Closes the underlying connection. Tests close per-case; the process-lifetime shared limiter never needs to. */
  close(): Promise<void>;
}

export interface CreateRedisRateLimiterOptions {
  redisUrl?: string;
  /** Injectable client for tests. Defaults to a real ioredis connection. */
  client?: RateLimitRedisClient;
  /** Injectable clock for tests. */
  now?: () => number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 10;

function redisUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.REDIS_URL ?? "redis://localhost:6379";
}

// Atomic check-and-increment: trims entries older than the window, counts
// what's left, and only records the new attempt if still under `max` — all
// inside one EVAL so concurrent requests against the same key (across
// however many apps/api machines share this key — see infra/fly/api-*.toml's
// min_machines_running) can't race between "count" and "add" the way two
// separate round-trips would.
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
redis.call("ZREMRANGEBYSCORE", key, "-inf", now - windowMs)
if redis.call("ZCARD", key) >= max then
  return 0
end
redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, windowMs)
return 1
`;

/**
 * A Redis sorted set doubling as a sliding window, same technique as
 * createRedisConcurrencyCounter: member = a unique id, score = the attempt's
 * timestamp. Superseded the old in-process Map once apps/api started running
 * with min_machines_running >= 2 per region — a per-process counter
 * under-counts by roughly the machine count once more than one process
 * shares the same key.
 */
export function createRedisRateLimiter(options: CreateRedisRateLimiterOptions = {}): RateLimiter {
  const now = options.now ?? Date.now;
  const client: RateLimitRedisClient =
    options.client ?? (new Redis(options.redisUrl ?? redisUrlFromEnv()) as unknown as RateLimitRedisClient);

  return {
    async check(key: string, checkOptions?: RateLimitOptions): Promise<boolean> {
      const windowMs = checkOptions?.windowMs ?? DEFAULT_WINDOW_MS;
      const max = checkOptions?.max ?? DEFAULT_MAX;
      const t = now();

      try {
        const allowed = await client.eval(
          SLIDING_WINDOW_SCRIPT,
          1,
          `ratelimit:${key}`,
          t,
          windowMs,
          max,
          `${t}:${randomUUID()}`,
        );
        return allowed === 1;
      } catch (err) {
        // Fail open: a Redis hiccup must never take down signup/login/ticket
        // minting entirely (docs/ARCHITECTURE.md "Degrade, never drop"), same
        // posture as concurrency-counter.ts's acquire()/release(). Logged
        // loudly since this is a security control quietly going dark, not a
        // benign capacity signal.
        console.error(`[rate-limiter] Redis error, failing open for key "${key}":`, err);
        return true;
      }
    },
    async close(): Promise<void> {
      await client.quit?.();
    },
  };
}

// Module-level singleton, same reasoning as ingestion-queue.ts's
// sharedQueue: a fresh ioredis connection per call would leak one per
// request with nothing ever closing it. Every real caller (auth, embed,
// conversation ticket routes) goes through this; tests use
// createRedisRateLimiter() directly with an injected client instead.
let sharedLimiter: RateLimiter | null = null;

export async function checkRateLimit(key: string, options?: RateLimitOptions): Promise<boolean> {
  if (!sharedLimiter) sharedLimiter = createRedisRateLimiter();
  return sharedLimiter.check(key, options);
}
