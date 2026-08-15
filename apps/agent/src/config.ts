import { z } from "zod";

/**
 * Env this worker needs, validated once at boot. Reuses the exact SIMLI_*
 * var names apps/api/src/lib/simli.ts already established — no renaming.
 *
 * Note: the base SIMLI_FACE_ID is used for every Mode B session in this
 * pass (a single global Enterprise photoreal face), not resolved per-Avatar
 * — the livekit-connect room metadata (apps/api/src/lib/livekit.ts) only
 * carries { orgId, trainingSessionId } today, with no avatarId to resolve a
 * per-avatar face against. Flagged as a known v1 limitation, not silently
 * dropped — a follow-up would thread avatarId through the room metadata the
 * same way apps/api's WS route resolves it via getCallerSimliFaceId.
 */
const agentConfigSchema = z.object({
  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  SIMLI_API_KEY: z.string().min(1),
  SIMLI_FACE_ID: z.string().min(1),

  /** Explicit-dispatch registration name — must match apps/api's LIVEKIT_AGENT_NAME. */
  LIVEKIT_AGENT_NAME: z.string().min(1).default("avatrain-livekit-agent"),
  /** How long to wait for a real (non-agent) participant before giving up — the cost gate's timeout. */
  AGENT_JOIN_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /** How long the room may sit with no active turn before the worker tears down. */
  AGENT_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(5 * 60_000),
  /** Hard cap on total session length, regardless of activity. */
  AGENT_MAX_SESSION_MS: z.coerce.number().int().positive().default(30 * 60_000),
  /** Grace period after the last human leaves, to tolerate a brief reconnect before tearing down. */
  LAST_HUMAN_GRACE_MS: z.coerce.number().int().positive().default(15_000),
  /**
   * Max concurrent sessions one worker process can hold — the denominator
   * in docs/ARCHITECTURE.md §4's "scale on sessions_concurrent /
   * worker_capacity, not CPU". The external autoscaler (infra/) reads this
   * alongside the live sessions_concurrent count; it is not enforced by
   * this process itself (@livekit/agents' own job dispatch already stops
   * handing this worker new jobs once it's at capacity).
   */
  WORKER_CAPACITY: z.coerce.number().int().positive().default(1),
  /**
   * Port for the /metrics endpoint (metrics-server.ts) that reports
   * sessions_concurrent and worker_capacity as Prometheus gauges. 9091 is
   * Fly.io's documented default scrape port (see infra/fly's `[metrics]`
   * block) — not a value this codebase invented.
   */
  METRICS_PORT: z.coerce.number().int().positive().default(9091),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return agentConfigSchema.parse(env);
}
