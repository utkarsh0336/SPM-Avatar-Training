# Spec: Reliability, Uptime & Disaster Recovery

## Status

Implemented on `feature/reliability-uptime-disaster-recovery`. All code-level work is done and
`pnpm verify` is green (see Definition of Done below). Four items remain genuinely unverifiable in
this sandbox — no live Fly account, no real Sentry project — and are called out explicitly rather
than assumed correct: the backup-verification workflow's `fly mpg` commands, a real synthetic-check
run against a deployed `apps/api`, actual Sentry email delivery, and a live single-region-outage
drill. This inherits (does not resolve) `auto-scaling.md`'s existing open items around unconfirmed
`fly mpg` capabilities and a never-yet-attempted `fly deploy`.

## Overview

Adds the operational-reliability layer that `docs/ROADMAP.md` Phase 8 (Hardening) requires and that
`feature/auto-scaling` (merged, PR #38, `4.1-done`) explicitly deferred: structured logging, error
tracking, SLO-backed alerting on top of the existing health/metrics endpoints, a public status page,
and a documented — and *tested* — Postgres backup/disaster-recovery policy.

Today there is no structured logging (`Fastify({ logger: false })`), no error tracking, no alerting
of any kind, no backup/restore policy for Postgres, and no status page. `apps/agent`'s
`/metrics` exposes exactly two gauges and nothing consumes them. A region outage or a corrupted
Postgres backup would currently only be discovered when a customer complains. This spec closes that
gap.

**Explicitly out of scope**: the 500-concurrent-session load test itself — `auto-scaling.md` already
named that as a separate follow-on pass, and it stays that way. This spec is about *detecting* and
*responding to* failures and *recovering* data, not about generating load.

---

## Open Decisions Requiring Approval

Same pattern `auto-scaling.md` used for its AWS-vs-Fly ADR: these get decided (and written up as
`docs/adr/0007-reliability-alerting-strategy.md`) before implementation, not during it.

1. **Alerting destination.** Sentry (see Dependencies) handles error capture and has built-in issue
   alert rules, but *where* they notify (Slack webhook, email, PagerDuty) is configured in Sentry's
   UI, not code, and needs an account/channel the user provides — there is no existing integration to
   reuse.
2. **Status page hosting.** Recommendation below is to self-host (`GET /status` served directly by
   `apps/api`, both regions) rather than adopt a third-party status-page vendor, to avoid a second new
   SaaS dependency. Tradeoff: the status page fate-shares with the infra it reports on — a
   **simultaneous** US+EU `apps/api` outage would take the page down too. A single-region outage does
   not, since `apps/api` already runs as two independent Fly apps. Accepted as an MVP limitation;
   revisit with an independently-hosted page if a contractual SLA later requires one.
3. **Backup retention window and restore RPO/RTO targets.** Fly Managed Postgres's actual backup/PITR
   capabilities were never confirmed against `fly mpg --help` (`auto-scaling.md` flagged this as an
   open blocker) — provisioning-time discovery, not a design choice this spec can lock in advance.

---

## Business Goal

Phase 8's exit criteria require holding SLOs under load and "a runbook for every alert that can page
someone" — neither is possible while zero alerting exists. Separately, this is a multi-tenant SaaS
with per-org data-residency commitments (`Organization.dataRegion`, EU orgs pinned to EU infra per
`docs/ARCHITECTURE.md` §6) — an undocumented, never-restored backup is a compliance exposure for those
customers, not just an operability gap. Detecting an outage from a dashboard instead of from a
customer's support ticket is the direct product of this work.

---

## Depends On

None as a hard blocker — `feature/auto-scaling` is already merged to `main` (PR #38). This spec builds
directly on what it introduced: `apps/api`'s `/healthz`/`/readyz`, `apps/agent`'s Prometheus
`/metrics`, and the four-Fly-app, region-pinned `infra/` topology. It also inherits that spec's still-
open item — read-replica support unconfirmed against `fly mpg` — which this spec's provisioning step
must resolve or re-flag (see Open Decisions #3).

---

## Components Affected

- apps/api
- apps/agent
- packages/shared
- prisma (root-level `prisma/schema.prisma`)
- infra/
- .github/workflows
- docs/adr, docs/runbooks (new subdirectory — not a new top-level directory)

---

## API Changes

- New `GET /v1/status` (`apps/api`) — public, unauthenticated, non-tenant-scoped JSON: current service
  status per region + recent `StatusIncident` history. Read-only, cached (short TTL) and rate-limited
  same as other unauthenticated routes, since it must stay cheap enough to survive being hit during an
  actual incident.
- New `GET /status` (`apps/api`) — server-rendered minimal HTML view of the same data, for humans.
  Deliberately not built into `apps/dashboard`: `apps/dashboard`'s deployment target was never
  established by the auto-scaling work (only `apps/api`/`apps/agent` got Dockerized/Fly-deployed), and
  a status page must not depend on infrastructure this spec can't yet confirm is independently
  available.
- New internal-only `POST /v1/internal/incidents`, `PATCH /v1/internal/incidents/:id` — create/update
  a `StatusIncident`. Gated by a separate internal-ops auth mechanism, **not** the customer/org JWT
  path — these are platform-operator actions, not tenant actions. Auth mechanism (static ops token vs.
  a real internal-admin role) is an implementation-time decision, not locked here.
- No changes to any existing `/v1` tenant-scoped route.

---

## Database Changes

Two new Prisma models, both **global / RLS-exempt** — same precedent as `User`/`OAuthAccount`, since
they describe platform infrastructure state, not tenant data, and carry no `orgId`:

- `UptimeCheck` — `region`, `service`, `checkedAt`, `status` (up/down), `latencyMs`. Written by the new
  synthetic-check workflow (see below). Indexed on `checkedAt` for retention pruning and on
  `(service, region, checkedAt)` for the status-page query.
- `StatusIncident` — `title`, `severity`, `status` (investigating/identified/monitoring/resolved),
  `affectedRegions`, `startedAt`, `resolvedAt`, public-facing `body` text (postmortem/updates).

One migration adds both tables. `scripts/verify-rls.mjs`'s exemption list needs updating to include
them (same mechanism already used for `User`/`OAuthAccount`).

Retention: `UptimeCheck` rows are pruned after 90 days by a new BullMQ repeatable job in `apps/api`
(reuses the existing Redis-backed queue infra the ingestion pipeline already depends on — no new
dependency, no new cron surface), not a GitHub Actions cron. Synthetic checks themselves *do* run as a
GitHub Actions cron deliberately — they need to originate **outside** Avatrain's own infra to catch a
full-region (or full-platform) outage that an in-process job couldn't observe.

No changes to any tenant-scoped table. `Organization.dataRegion` is read, not modified, by the
synthetic-check workflow (to know which region's `/readyz` to poll — see infra changes).

---

## UI Changes

- New minimal public status page at `apps/api`'s `GET /status` (see API Changes) — plain server-
  rendered HTML, no client framework, consistent with the embed loader's "as little client JS as
  possible" posture even though this isn't part of the embed bundle itself.
- No changes to Widget, Avatar, or existing Dashboard analytics UI.
- Incident authoring is API-only for this pass (`POST`/`PATCH /v1/internal/incidents`) — no admin UI
  screen. A dashboard "Incidents" panel is a reasonable Phase-8-adjacent follow-up, not required to
  meet this spec's goal of *detecting and communicating* outages.

---

## Realtime Changes

No changes to the OpenAI Realtime transport, WebRTC path, or the LiveKit worker's session lifecycle.
Any Sentry instrumentation added to `apps/agent` (error capture, breadcrumbs) must stay off the
per-turn audio callback path — same constraint `.claude/rules/realtime.md` already imposed on the
concurrency counter in `auto-scaling.md`: session-lifecycle-boundary hooks only (init, teardown), never
inside a per-turn handler.

---

## Files to Modify

- `apps/api/src/app.ts` — enable structured logging (Pino via Fastify's native `logger` option,
  replacing `logger: false`), initialize Sentry, register `/v1/status`, `/status`, and the internal
  incident routes.
- `apps/api/src/config.ts` (or wherever the env schema lives) — add `SENTRY_DSN` (optional — Sentry
  disabled if unset, so this never breaks local dev), `LOG_LEVEL`.
- `apps/agent/src/index.ts` — initialize Sentry and the shared Pino logger at process start.
- `apps/agent/src/config.ts` — add `SENTRY_DSN`, `LOG_LEVEL` (same optional-by-default pattern).
- `apps/agent/src/metrics-server.ts` — add error-rate and session-failure-count gauges alongside the
  existing two, following its established hand-rolled Prometheus text-format pattern (no new
  dependency — see Dependencies).
- `packages/shared/src/index.ts` — re-export the new `./observability` barrel.
- `prisma/schema.prisma` — add `UptimeCheck`, `StatusIncident` models.
- `scripts/verify-rls.mjs` — add both new tables to the RLS-exemption allowlist.
- `infra/README.md` — document the Fly Managed Postgres backup/PITR policy once confirmed (Open
  Decisions #3), add a restore runbook pointer, document `SENTRY_DSN` as a Fly secret per app.
- `infra/fly/api-us.toml`, `api-eu.toml` — add `[metrics]` scrape config (currently only the agent
  Fly apps have this, per `auto-scaling.md`).
- `docs/ARCHITECTURE.md` — document the SLO/alerting posture and the status page under a new section,
  consistent with how it already documents failure-mode degradation in §2.
- `README.md` — add a Reliability section pointing at `docs/runbooks/`, mirroring the Deployment
  section `auto-scaling.md` added.

---

## Files to Create

**App code:**
- `packages/shared/src/observability/logger.ts` — Pino factory (shared config for `apps/api` and
  `apps/agent`).
- `packages/shared/src/observability/sentry.ts` — Sentry init helper, no-ops when `SENTRY_DSN` is
  unset.
- `packages/shared/src/observability/index.ts` — barrel.
- `apps/api/src/routes/status.ts`, `status.test.ts` — `GET /v1/status`, `GET /status`.
- `apps/api/src/routes/internal-incidents.ts`, `.test.ts` — incident CRUD, internal auth.
- `apps/api/src/lib/uptime-retention-job.ts`, `.test.ts` — BullMQ repeatable pruning job.

**Infra / automation:**
- `.github/workflows/synthetic-uptime-check.yml` — scheduled cron; polls `/healthz` + `/readyz` for
  both `apps/api` regions and both `apps/agent` regions' `/metrics`; writes `UptimeCheck` rows via a
  small authenticated internal call; reports failures to Sentry so existing issue-alert rules fire
  (no bespoke notification code/vendor to build).
- `.github/workflows/backup-verification.yml` — scheduled cron; restores the latest Fly Managed
  Postgres backup to a scratch instance, runs a row-count/checksum sanity query, tears the scratch
  instance down, reports failure to Sentry. This is the actual DR test — a documented policy nobody
  has ever exercised is not disaster recovery.
- `docs/adr/0007-reliability-alerting-strategy.md` — records the Open Decisions above once resolved.
- `docs/runbooks/incident-response.md` — how to triage a firing alert, update `StatusIncident`.
- `docs/runbooks/postgres-restore.md` — step-by-step restore procedure, cross-referenced by the
  backup-verification workflow so the automated test and the human runbook can't drift apart.
- `docs/runbooks/region-failover.md` — what "failover" means given the region-pinning constraint in
  `docs/ARCHITECTURE.md` §6 (per-region recovery, never cross-region data movement — an EU org's data
  never fails over into US infra).
- `prisma/migrations/<timestamp>_add_uptime_status_models/migration.sql`.

---

## Dependencies

Two new runtime dependencies, both requiring explicit approval per `CLAUDE.md`:

- **`pino`** (+ `pino-pretty` as a dev dependency for local formatting) — Fastify's native structured
  logger. Zero-config alternative already exists nowhere in this repo; every current log call is raw
  `console.*`. Added to `apps/api` and `apps/agent` only.
- **`@sentry/node`** — error capture and issue alerting. Added to `apps/api` and `apps/agent` only.
  **Explicitly not added to `apps/widget` or `packages/embed`** — the embed loader's `≤10KB gzipped,
  zero dependencies` budget (`docs/ROADMAP.md` Phase 4) and the "never expose secrets / minimize
  client surface" posture both rule it out client-side; server-side error capture already covers the
  paths that matter.

No new dependency for metrics (extends `apps/agent`'s existing hand-rolled Prometheus text-format
pattern into `apps/api` rather than adding `prom-client`), and no new dependency for the status page
(server-rendered from `apps/api`, no status-page SaaS — see Open Decisions #2).

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY`
- Maintain tenant isolation using `org_id` — `UptimeCheck`/`StatusIncident` are the deliberate
  exception (global, RLS-exempt, no tenant data), not a precedent for weakening RLS elsewhere
- Keep provider-specific logic inside adapters — Sentry init confined to
  `packages/shared/src/observability/sentry.ts`
- Validate APIs with Zod — `/v1/status` response shape and internal incident payloads included
- Preserve the public embed SDK contract — no observability dependency added to the embed bundle
- Keep realtime latency low — no Sentry/logging instrumentation inside any per-turn audio handler
- Use strict TypeScript
- Never use `any`
- Prefer modifying existing code
- Run `pnpm verify`
- Update documentation when public APIs change
- `SENTRY_DSN` is not a secret in the traditional sense (it's meant to be embedded in error-reporting
  clients) but stays server-side only here since Sentry is not added to any client bundle
- Region-pinning is a hard constraint on DR design: no runbook or automated recovery path may move an
  EU org's data into US infra, or vice versa (`docs/ARCHITECTURE.md` §6)

---

## Testing

- **Unit/integration tests**: `status.test.ts`, `internal-incidents.test.ts`,
  `uptime-retention-job.test.ts` (against real Redis/Postgres, matching this repo's existing
  convention), Sentry/logger init helpers tested for the no-op-when-unset path.
- **`verify-rls.mjs`**: extended and re-run to confirm the two new tables are correctly exempt and
  every other table remains enforced.
- **Synthetic-check workflow**: dry-run against a real deployed `/healthz`/`/readyz` before enabling
  the schedule.
- **Backup-restore drill**: the `backup-verification.yml` workflow *is* the test — it must be run
  successfully at least once against a real Fly Managed Postgres backup before this feature is
  considered done, not merely written and left unexecuted.
- **Manual verification**: confirm Sentry issue-alert rules actually notify the chosen destination
  (Open Decisions #1) using a deliberately-triggered test error in a non-prod environment; confirm the
  status page renders correctly during a simulated single-region outage (stop one Fly app, verify the
  other region's `/status` still reports it as down).
- Latency benchmarks: `pnpm bench:latency` unaffected — no hot-path code touched — not re-run, per
  `.claude/rules/realtime.md`, same as `auto-scaling.md`'s precedent.

---

## Definition of Done

- [x] Feature works end-to-end (logging, error capture, `/v1/status`, `/status`, incident CRUD, all
  tested against real Redis/Postgres — 45 test files / 529 tests in `apps/api` pass, including the
  new `config.test.ts`, `status.test.ts`, `internal.test.ts`, `metrics.test.ts`,
  `uptime-retention-job.test.ts`)
- [x] `pnpm verify` passes, no lint or TypeScript errors (added `fetch`/`AbortSignal` Node-20 globals
  to `eslint.config.mjs`'s `scripts/**/*.mjs` block — `report-uptime-check.mjs` is the first script
  here to make an HTTP call)
- [x] `verify-rls.mjs` passes with the two new tables correctly exempted
- [x] `docs/adr/0007-reliability-alerting-strategy.md` written, Open Decisions resolved (all three
  approved via AskUserQuestion: both deps approved, email-only Sentry alerting, self-hosted status
  page)
- [x] Documentation updated (`docs/ARCHITECTURE.md` new §8, `infra/README.md`'s new "Reliability,
  alerting, and backups" section, `README.md`'s new "Reliability" section, this spec)
- [x] `docs/runbooks/` written (incident response, Postgres restore, region failover)
- [ ] Backup-verification workflow executed successfully at least once against a real backup, not just
  written — **cannot be done in this sandbox, no live Fly account**. The workflow's `fly mpg`
  commands are explicitly flagged in its own header as unverified against real `flyctl` output —
  same open item `auto-scaling.md` left for read-replica support. Confirm both together before
  trusting either.
- [ ] Synthetic-uptime-check workflow executed successfully against real deployed health endpoints —
  **cannot be done in this sandbox**; `apps/api` was never `fly deploy`'d (same gap `auto-scaling.md`
  left open). `scripts/report-uptime-check.mjs` was written and lint/type-clean but only exercised
  indirectly (its logic mirrors what `status.test.ts`/`internal.test.ts` cover against a local app
  instance, not a real `fly deploy`).
- [ ] Sentry alert rule confirmed to actually notify the chosen destination (test error, non-prod) —
  **cannot be done without a real Sentry account/DSN**; `initSentry()`'s no-op-when-unset path is
  unit-tested, the actual email delivery is not.
- [ ] Status page verified to survive a simulated single-region outage — **cannot be done without a
  real two-region Fly deployment**; the underlying claim (each region is an independent Fly app) is
  architectural fact from `auto-scaling.md`, not newly verified here.
- [x] Latency budget maintained (no hot-path code touched — confirmed via `.claude/rules/realtime.md`
  review; `pnpm bench:latency` not re-run, same precedent `auto-scaling.md` set)
- [x] No security regressions; no observability dependency present in any client bundle (embed bundle
  re-measured at 1919B gzipped post-change, budget 10240B — unchanged, since neither `pino` nor
  `@sentry/node` touch `apps/widget`/`packages/embed`)
