# Spec: Auto-Scaling

## Status

Implemented on `feature/auto-scaling`. This spec's original draft targeted AWS/Kubernetes/Terraform;
it was rewritten after the user picked a simpler PaaS (Fly.io) over that — see
`docs/adr/0006-autoscaling-strategy.md` for the decision record. Everything below reflects what was
actually built, not the earlier draft.

---

## Overview

Introduces production deployment infrastructure — containerization, orchestration, and horizontal
autoscaling — for `apps/api` and `apps/agent`. Before this, the only deployment artifact in this repo
was `docker-compose.yml` (local Postgres + Redis only, no app containers) and one CI workflow that
runs `pnpm verify`. There was no Dockerfile for any app, no orchestration config, and no
infrastructure-as-code.

This adds:

- Dockerfiles for `apps/api` and `apps/agent` (multi-stage, `pnpm deploy`-based).
- Two distinct autoscaling strategies, because the two services scale on different signals
  (`docs/ARCHITECTURE.md` §4–§5 already specifies both):
  - `apps/api` is stateless → Fly's native request-concurrency autoscaling
    (`[http_service.concurrency]`).
  - `apps/agent` is I/O-bound, not CPU-bound → a custom-metric autoscaler
    (`superfly/fly-autoscaler`) driven by `sessions_concurrent / worker_capacity`, sourced from a new
    Redis-backed counter this spec introduces.
- Four Fly apps (API × 2 regions, agent × 2 regions) rather than two multi-region apps — hard
  region pinning per `Organization.dataRegion`, see `infra/README.md`.
- A manual-only (`workflow_dispatch`) deploy workflow — infra changes are high blast-radius and must
  not auto-apply on every merge to `main`.

Full rationale, provisioning steps, and deploy commands: `infra/README.md`.

---

## Business Goal

`docs/ROADMAP.md` Phase 8 (Hardening) requires holding SLOs at 500 concurrent sessions before the
platform is production-ready, and `docs/ARCHITECTURE.md` §4–§5 already specify how `apps/api` and
`apps/agent` are supposed to scale. Neither was possible before this spec: there was no
infrastructure to run more than one instance of either service. Mode B (photoreal/LiveKit) sessions
are directly billable per `docs/ROADMAP.md` Phase 7, so a worker pool that can't scale with demand is
lost revenue, not just a latency problem.

---

## Depends On

None as a hard blocker. Logically follows `docs/ROADMAP.md` Phase 8 (Hardening); this spec
implements the scaling half of that phase's prerequisites. The load-test itself (500 concurrent
sessions, SLO verification) is out of scope here and should follow as its own pass now that this
infrastructure exists.

---

## Components Affected

- apps/api
- apps/agent
- packages/shared
- infra/ (new top-level directory, approved by the user before implementation)
- .github/workflows

---

## API Changes

- `GET /healthz` (`apps/api/src/app.ts`) — unchanged, bare liveness check.
- New `GET /readyz` (`apps/api/src/routes/health.ts`) — readiness probe. Checks a live DB round-trip
  (`prisma.$queryRaw\`SELECT 1\``) and Redis connectivity (`pingRedis()`); returns 503 until both
  succeed. This is what Fly's `[[http_service.checks]]` in `infra/fly/api-*.toml` polls before
  routing traffic to a new machine — `/healthz` alone doesn't check dependencies.
- Neither route is under `/v1`, both are unauthenticated and return no tenant data — same posture as
  the pre-existing `/healthz`.

---

## Database Changes

No Prisma schema changes. `sessions_concurrent` lives in Redis (a sorted set, not a plain counter —
see below), not Postgres — intentionally: it's a rolling, ephemeral signal, exactly
`docs/ARCHITECTURE.md` §3's "Quotas, concurrency counters | Redis | Rolling window" category.

`infra/README.md` documents provisioning Fly Managed Postgres with `pgvector` enabled per region, and
flags that read-replica support (`docs/ARCHITECTURE.md` §5's "never run dashboard aggregations
against the primary") needs to be re-verified against `fly mpg` at provisioning time — not confirmed
as part of this pass.

---

## UI Changes

```
No UI changes.
```

---

## Realtime Changes

- `apps/agent/src/livekit-worker.ts`: right after the cost gate passes (`waitForHumanParticipant`
  resolves) — the point a session actually starts consuming a paid provider connection — calls
  `concurrencyCounter.acquire(trainingSessionId, AGENT_MAX_SESSION_MS + 30s buffer)`. Inside the
  teardown watcher's `onTeardown` callback (covers all three normal exit reasons), calls
  `concurrencyCounter.release(trainingSessionId)`.
- Both are once-per-session-lifecycle calls, not per-turn — off the audio hot path, consistent with
  `.claude/rules/realtime.md`'s "nothing new in the audio callback path."
- `acquire()`/`release()` fail open (log and swallow) by design — a Redis hiccup must never block or
  kill a learner's session (`docs/ARCHITECTURE.md` "Degrade, never drop"). The counter is a Redis
  sorted set (member = sessionId, score = expiry timestamp) rather than a plain `INCR`/`DECR` pair
  specifically so a crashed worker process — which never gets to call `release()` — self-heals once
  its entry's TTL passes, instead of permanently inflating the scaling signal. See
  `packages/shared/src/scaling/concurrency-counter.ts`'s doc comments.
- No changes to the OpenAI Realtime transport, WebRTC path, or Mode A (mediated) sessions — only Mode
  B (LiveKit) worker sessions are instrumented, since that's the pool this spec autoscales.
  `apps/api` scales on request concurrency (stateless), not on this counter.

---

## Files Modified

- `apps/agent/src/livekit-worker.ts` — concurrency counter acquire/release around the session
  lifecycle (see Realtime Changes above).
- `apps/agent/src/config.ts` — added `WORKER_CAPACITY` (autoscaler denominator) and `METRICS_PORT`
  (default `9091`, matching Fly's scrape default).
- `apps/agent/src/index.ts` — starts `metrics-server.ts` alongside the LiveKit worker CLI.
- `apps/agent/src/config.test.ts` — covers the two new env vars' defaults.
- `apps/api/src/app.ts` — registers the new health routes.
- `packages/shared/package.json` — added `ioredis` as a direct dependency; added the `./scaling`
  subpath export.
- `packages/shared/src/index.ts` — re-exports `./scaling/index.js`.
- `scripts/verify-provider-boundary.mjs` — added `ioredis` to `RESTRICTED_IMPORTS`, confined to
  `packages/shared/src/scaling/*` — same enforcement pattern the script already applies to `bullmq`,
  `livekit-server-sdk`, etc.
- `pnpm-lock.yaml` — updated for the new `ioredis` dependency.
- `README.md` — added a Deployment section pointing at `infra/README.md`.

---

## Files Created

**App code:**
- `apps/api/Dockerfile`, `apps/agent/Dockerfile` — multi-stage, `pnpm deploy`-based (see their header
  comments for why `pnpm deploy` over hand-rolled `node_modules` pruning)
- `.dockerignore` (repo root — shared by both Dockerfiles' build context)
- `apps/api/src/routes/health.ts`, `apps/api/src/routes/health.test.ts` — `/readyz`
- `apps/agent/src/metrics-server.ts`, `apps/agent/src/metrics-server.test.ts` — Prometheus
  `/metrics` endpoint Fly's scraper reads
- `packages/shared/src/scaling/concurrency-counter.ts`, `.../concurrency-counter.test.ts`
- `packages/shared/src/scaling/redis-ping.ts` (backs `/readyz`'s Redis check)
- `packages/shared/src/scaling/index.ts` (barrel)

**Infra-as-code (`infra/` — new top-level directory, approved):**
- `infra/README.md` — deployment/provisioning reference, start here
- `infra/fly/api-us.toml`, `api-eu.toml` — apps/api, native concurrency autoscaling
- `infra/fly/agent-us.toml`, `agent-eu.toml` — apps/agent, `[metrics]` scrape config
- `infra/fly/autoscaler-agent-us.yml`, `autoscaler-agent-eu.yml` — `fly-autoscaler` config
- `.github/workflows/deploy.yml` — `workflow_dispatch`-gated deploy, separate from `ci.yml`

**ADR:**
- `docs/adr/0006-autoscaling-strategy.md`

---

## Dependencies

- `ioredis` (`^5.4.1`) — new direct dependency on `packages/shared`, for the concurrency counter and
  `/readyz`'s Redis check. Not previously a direct dependency anywhere in the repo (`apps/api`'s
  existing Redis usage goes through `bullmq`, which vendors its own connection). **Import via the
  named `{ Redis }` export, not the default export** — `import Redis from "ioredis"` fails to
  typecheck under this repo's `module: NodeNext` + `"type": "module"` config
  (`TS2351: This expression is not constructable`), a real, verified issue with this exact
  TypeScript/module setup, not a hypothetical.
- Infra tooling (`flyctl`, `fly-autoscaler`) — deployment tooling, not npm packages. Called out
  explicitly since CLAUDE.md's "never add new dependencies without approval" reasonably extends to
  infra tooling choices.

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY`
- Maintain tenant isolation using `org_id`
- Keep provider-specific logic inside adapters — `ioredis` is confined to
  `packages/shared/src/scaling/*`, enforced by `scripts/verify-provider-boundary.mjs`
- Validate APIs with Zod
- Preserve the public embed SDK contract
- Keep realtime latency low — counter acquire/release stay off the per-turn audio path and fail open
- Use strict TypeScript
- Never use `any`
- Prefer modifying existing code
- Run `pnpm verify`
- Update documentation when public APIs change
- Multi-region: every Fly resource respects `Organization.dataRegion` — see infra/README.md's "Why
  four apps, not one"

---

## Testing

Verified as part of implementation (real infra, not mocked, matching this repo's existing testing
convention — see `apps/api/src/lib/ingestion-queue.test.ts`):

- **Unit/integration tests**: `concurrency-counter.test.ts` (5 tests, run against a real local Redis
  — acquire/release/count correctness, TTL-based self-healing on a simulated crash, fail-open on
  acquire/release vs. fail-closed on count()), `metrics-server.test.ts` (3 tests — gauge output, 503
  on a broken counter, 404 on other paths), `config.test.ts` (new env var defaults). All pass.
- **`pnpm --filter @avatrain/shared typecheck`**, **`pnpm --filter @avatrain/agent typecheck`**,
  **`pnpm --filter @avatrain/api typecheck`** — all clean.
- **`pnpm lint`** — 0 errors (pre-existing unrelated warnings only).
- **`node scripts/verify-provider-boundary.mjs`**, **`node scripts/verify-rls.mjs`** — both pass.
- **`apps/api/src/routes/health.test.ts`**: initially caught this environment's local Postgres in a
  genuinely corrupted state (Docker Desktop's local containerd content store was corrupted,
  independent of this work — `docker run hello-world` failed identically — and the host disk had
  under 2GB free) and correctly returned 503, confirming `/readyz` fails closed rather than silently
  reporting healthy. After the environment was fixed (disk space freed, Docker Desktop restarted),
  re-ran green: real 200 `{"status":"ready"}`.
- **Full `docker build` → boot, both images**: completed once the environment above was fixed.
  `avatrain-api:test` and `avatrain-agent:test` both built end-to-end and were run against this
  machine's real `docker-compose.yml` Postgres/Redis — `apps/api`'s `/healthz` and `/readyz` both
  returned real 200s over an actual HTTP request to the running container; `apps/agent` booted,
  logged `starting worker`, and its `:9091/metrics` endpoint returned both real Prometheus gauges.
  This pass caught and fixed two genuine bugs, now in both Dockerfiles (see their builder-stage
  comments and `infra/README.md`'s "Local validation" section for the full detail):
  1. Missing `python3`/`make`/`g++`/`openssl` in the base image (native addon builds, Prisma
     query-engine target detection).
  2. `pnpm deploy` doesn't carry over `@prisma/client`'s *generated* output — booting without the
     fix crashed immediately with `@prisma/client did not initialize yet`. Fixed by regenerating the
     client post-deploy at the exact path `@avatrain/shared`'s own module resolution needs it at.
  This also surfaced a real, pre-existing architectural finding: `apps/agent` transitively imports
  `packages/shared/src/db/client.ts` (via the root barrel) and so needs `DATABASE_URL`/
  `APP_DATABASE_URL` set at runtime even though it never queries Postgres directly — documented in
  `infra/README.md` and both `infra/fly/agent-*.toml` files.
- **Latency Benchmarks**: `pnpm bench:latency` unaffected, not re-run (no realtime-hot-path code
  changed — only session-lifecycle-boundary calls, per `.claude/rules/realtime.md`).
- **Manual Verification remaining**: `fly deploy` against a real Fly org (this pass validated the
  images locally, not an actual Fly deployment); confirm `fly-autoscaler` actually scales
  `avatrain-agent-*` machine count under simulated load; confirm the pgvector/read-replica
  provisioning steps in `infra/README.md` against current `fly mpg` output.

---

## Definition of Done

- [x] Feature works end-to-end at the code level (counter, metrics endpoint, readiness probe, all
  unit/integration-tested against real Redis/Postgres where reachable)
- [x] `pnpm lint` / `pnpm --filter <touched> typecheck` / touched packages' tests pass
- [x] `verify-provider-boundary` / `verify-rls` pass
- [x] Documentation updated (`infra/README.md`, root `README.md`, ADR-0006, this spec)
- [x] Latency budget maintained (no hot-path code touched)
- [x] No security regressions
- [x] Cloud-provider decision and new `infra/` top-level directory explicitly approved before
  implementation
- [x] Full `docker build` → boot verified for both images, against real local Postgres/Redis (see
  Testing section) — caught and fixed two real bugs plus one architectural finding in the process
- [ ] `fly deploy` verified against a real Fly org (not yet attempted — needs a real Fly account)
- [ ] Read-replica provisioning confirmed against current `fly mpg` capabilities
