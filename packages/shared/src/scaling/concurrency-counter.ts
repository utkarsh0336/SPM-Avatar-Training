import { Redis } from "ioredis";

/**
 * Minimal surface this module needs from ioredis — narrowed so tests (and
 * any future non-ioredis backend) only have to satisfy four methods instead
 * of the full client.
 */
export interface ConcurrencyRedisClient {
  zadd(key: string, score: number, member: string): Promise<number>;
  zrem(key: string, member: string): Promise<number>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
  zcard(key: string): Promise<number>;
  quit(): Promise<unknown>;
}

export interface ConcurrencyCounter {
  /**
   * Marks `sessionId` active until `ttlMs` from now. TTL-bounded rather
   * than paired with a required release() — a worker process that crashes
   * before ever calling release() self-heals: the entry ages out of
   * count()'s window on its own instead of permanently inflating the
   * scaling signal. Callers should pass their own hard session-length cap
   * (e.g. apps/agent's AGENT_MAX_SESSION_MS) plus a small buffer.
   *
   * Fails open: a Redis error is logged and swallowed, never thrown — this
   * is called from the agent worker's session-start path, and a Redis
   * hiccup must never block or kill a learner's session
   * (docs/ARCHITECTURE.md "Degrade, never drop").
   */
  acquire(sessionId: string, ttlMs: number): Promise<void>;
  /**
   * Marks `sessionId` no longer active. Same fail-open contract as
   * acquire(). Safe to call even if the entry already expired.
   */
  release(sessionId: string): Promise<void>;
  /**
   * Current count of active sessions across every worker process sharing
   * this Redis instance — the autoscaler's `sessions_concurrent`
   * numerator (docs/ARCHITECTURE.md §4: "Scale on sessions_concurrent /
   * worker_capacity, not CPU"). Unlike acquire()/release(), this rejects on
   * a Redis error rather than failing open to 0 — the external autoscaler
   * polling this must never mistake "Redis is down" for "no load" and
   * scale the worker pool to zero.
   */
  count(): Promise<number>;
  /** Closes the underlying connection. Tests close per-case; long-lived callers generally don't need this. */
  close(): Promise<void>;
}

export interface CreateRedisConcurrencyCounterOptions {
  redisUrl?: string;
  /** Sorted-set key. Override in tests to avoid collisions across parallel test files sharing one Redis instance. */
  key?: string;
  /** Injectable client for tests. Defaults to a real ioredis connection. */
  client?: ConcurrencyRedisClient;
  /** Injectable clock for tests. */
  now?: () => number;
}

const DEFAULT_KEY = "avatrain:sessions:active";

function redisUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.REDIS_URL ?? "redis://localhost:6379";
}

/**
 * A Redis sorted set doubling as a rolling window (docs/ARCHITECTURE.md §3:
 * "Quotas, concurrency counters | Redis | Rolling window"): member =
 * sessionId, score = expiry timestamp. count() sweeps expired members
 * before reading cardinality, so a crashed worker's never-released entry
 * disappears on its own once its TTL passes rather than requiring a reaper
 * process.
 */
export function createRedisConcurrencyCounter(
  options: CreateRedisConcurrencyCounterOptions = {},
): ConcurrencyCounter {
  const key = options.key ?? DEFAULT_KEY;
  const now = options.now ?? Date.now;
  const client: ConcurrencyRedisClient =
    options.client ?? (new Redis(options.redisUrl ?? redisUrlFromEnv()) as unknown as ConcurrencyRedisClient);

  return {
    async acquire(sessionId, ttlMs) {
      try {
        await client.zadd(key, now() + ttlMs, sessionId);
      } catch (err) {
        console.error("[concurrency-counter] acquire failed, continuing without it:", err);
      }
    },
    async release(sessionId) {
      try {
        await client.zrem(key, sessionId);
      } catch (err) {
        console.error("[concurrency-counter] release failed:", err);
      }
    },
    async count() {
      await client.zremrangebyscore(key, "-inf", now());
      return client.zcard(key);
    },
    async close() {
      await client.quit();
    },
  };
}
