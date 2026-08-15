import { z } from "zod";

/**
 * First centralized env schema for this app — every other env var here is
 * still read ad hoc via `process.env.X ?? default` scattered across files.
 * Only the vars this feature introduces are validated up front; this is not
 * an attempt to migrate the rest of the app's env reads in the same pass.
 */
const apiConfigSchema = z.object({
  /** Sentry DSN. Optional — Sentry stays a true no-op (see packages/shared/src/observability/sentry.ts) when unset, so local dev and CI never need a Sentry account. */
  SENTRY_DSN: z.string().url().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /**
   * Shared bearer token gating POST/PATCH /v1/internal/* (uptime-check
   * ingestion, incident CRUD) — a separate trust boundary from the
   * customer/org JWT+session auth path in plugins/auth.ts. Held by the
   * synthetic-check and backup-verification GitHub Actions workflows as a
   * repo secret, and by this app as a Fly secret. Optional (fail-closed,
   * not app-crashing, when unset — see routes/internal.ts): every other
   * route, and every existing route test that calls buildApp(), must keep
   * working with no env changes even before this token is provisioned.
   * Minimum length guards against an accidentally-trivial value once set.
   */
  INTERNAL_OPS_TOKEN: z.string().min(32).optional(),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return apiConfigSchema.parse(env);
}
