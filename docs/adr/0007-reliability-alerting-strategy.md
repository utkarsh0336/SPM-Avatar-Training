# ADR-0007: Reliability, alerting, and status-page strategy

## Status

Accepted, implemented in `.claude/specs/reliability-uptime-disaster-recovery.md`.

## Context

`docs/ROADMAP.md` Phase 8 (Hardening) requires SLOs held under load and "a runbook for every alert
that can page someone." `feature/auto-scaling` (`docs/adr/0006-autoscaling-strategy.md`) built the
infra substrate — Fly.io deployment, `/healthz`/`/readyz`, `apps/agent`'s Prometheus `/metrics` — but
explicitly deferred everything about detecting failures, alerting on them, communicating status
publicly, and recovering data. Before this decision, `apps/api` ran `Fastify({ logger: false })`,
neither app had error tracking, no alerting or status page existed in any form, and Postgres had no
documented (let alone tested) backup/restore policy.

## Decision

**Pino for structured logging, `@sentry/node` for error tracking and alerting — two new
dependencies, confined to `apps/api` and `apps/agent` only.** Both are approved exceptions to
`CLAUDE.md`'s "never add new dependencies without approval." Neither is added to `apps/widget` or
`packages/embed` — the embed loader's `≤10KB gzipped, zero dependencies` budget
(`docs/ROADMAP.md` Phase 4) rules that out, and server-side capture already covers the paths that
matter. `@sentry/node` is confined to `packages/shared/src/observability/sentry.ts` and enforced by
`scripts/verify-provider-boundary.mjs`, the same pattern already applied to `ioredis`/`bullmq`/
`livekit-server-sdk`.

**Alerting destination: Sentry's own issue-alert rules, routed to email for this pass.** No Slack or
PagerDuty integration was set up — there is no existing channel/account to wire into, and adding one
was out of scope for this pass. This keeps exactly one alerting pipeline: both application errors
(`apps/api/src/lib/http-errors.ts`'s `handleError`) and synthetic-check failures
(`apps/api/src/services/status-service.ts`'s `recordUptimeCheck`, called from
`scripts/report-uptime-check.mjs`) report through the same `Sentry.captureException`/
`captureMessage` path, rather than building a second bespoke notification system.

**Self-hosted status page (`GET /status` / `GET /v1/status`, served by `apps/api`), not a
third-party status-page vendor.** Avoids a second new SaaS dependency/account. Known tradeoff,
accepted deliberately: the page is unreachable only if `apps/api-us` and `apps/api-eu` are both down
simultaneously — a single-region outage still renders correctly from the surviving region, since
they're genuinely independent Fly apps (`docs/adr/0006`'s "why four apps, not one"). Revisit with an
independently-hosted page if a contractual SLA later requires surviving a full-platform outage.

**Hand-rolled Prometheus text format for `apps/api`'s new `/metrics` route, not `prom-client`.**
Matches `apps/agent/src/metrics-server.ts`'s existing pattern exactly (no `prom-client` dependency
anywhere in this repo) rather than introducing a second metrics-formatting approach.

**A single shared bearer token (`INTERNAL_OPS_TOKEN`) for `/v1/internal/*`, not a new RBAC role.**
Entirely separate trust boundary from the customer/org JWT+session path in
`apps/api/src/plugins/auth.ts` — authorizes exactly two things (writing `UptimeCheck` rows,
creating/updating `StatusIncident` rows), never tenant data. The simplest option consistent with the
codebase's existing patterns, since no internal-admin-role system exists to build on. Made optional
in `apps/api/src/config.ts` and fails **closed** (503, not silently-open) when unset — deliberately,
so every existing route and its tests keep working with zero env changes before this token is
provisioned, without "unset" ever meaning "auth is skipped."

**`UptimeCheck` and `StatusIncident` as global, RLS-exempt Prisma models, not tenant-scoped.**
Platform infrastructure state, not tenant business data — same reasoning `User`/`OAuthAccount`
already established. `scripts/verify-rls.mjs`'s `EXEMPT_TABLES` extended accordingly.

## Consequences

- `apps/api` gains structured logging (Fastify's own `logger: { name, level }` option, not a raw
  Pino instance passed via `loggerInstance` — that path hit a real Fastify/pino type mismatch once
  threaded through `withTypeProvider()`, see `apps/api/src/app.ts`'s comment) and an error-tracking
  dependency it didn't have before.
- `apps/agent` gains the same, plus two new Prometheus gauges
  (`avatrain_agent_error_count_total`, `avatrain_agent_session_failure_count_total` in
  `apps/agent/src/metrics-server.ts`) fed from `livekit-worker.ts`'s existing `onError` callbacks and
  its two genuinely-abnormal exit paths (invalid room metadata, cost-gate timeout) — never from the
  three `TeardownReason` values, which are healthy, expected session endings.
- The synthetic-uptime-check workflow only covers `apps/api`'s two regions, not `apps/agent` — the
  agent Fly apps have no public `[http_service]` at all (LiveKit workers, not HTTP servers), so
  nothing about them is reachable from a GitHub Actions runner outside Fly's private network.
  `apps/agent`'s liveness stays covered by Fly's pre-existing internal Prometheus scrape feeding
  `fly-autoscaler`, unchanged by this decision.
- Backup/restore is now automated (`.github/workflows/backup-verification.yml`) but the exact
  `fly mpg` backup/restore command surface was never confirmed against a live Fly account — this
  inherits `docs/adr/0006`'s already-open read-replica-confirmation gap rather than closing it; both
  remain real, named, unresolved items to verify at provisioning time, not silently assumed correct.
