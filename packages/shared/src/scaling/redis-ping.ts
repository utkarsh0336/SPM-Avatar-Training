import { Redis } from "ioredis";

/**
 * Readiness-probe helper only — resolves if Redis answers PING, rejects
 * otherwise. Opens and closes a short-lived connection per call; not on any
 * realtime hot path (apps/api's /readyz route is the only caller).
 */
export async function pingRedis(redisUrl?: string): Promise<void> {
  const client = new Redis(redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await client.connect();
    await client.ping();
  } finally {
    client.disconnect();
  }
}
