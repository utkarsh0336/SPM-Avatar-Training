# Infra — deployment and autoscaling

Companion to `docs/ARCHITECTURE.md` §4–§6 and `.claude/specs/auto-scaling.md`. Read the spec first —
this file is the "how to actually run it" reference, not the design rationale.

Target platform: **Fly.io** (chosen over Kubernetes/a hyperscaler — see
`docs/adr/0006-autoscaling-strategy.md`). All CLI commands below are `flyctl`; install per
[fly.io/docs/flyctl/install](https://fly.io/docs/flyctl/install/).

---

## Why four apps, not one

`apps/api` and `apps/agent` are each deployed as **two separate Fly apps** — one per region — rather
than one app spanning both regions:

| Fly app | Service | Region |
|---|---|---|
| `avatrain-api-us` | apps/api | `iad` (US) |
| `avatrain-api-eu` | apps/api | `fra` (EU) |
| `avatrain-agent-us` | apps/agent | `iad` (US) |
| `avatrain-agent-eu` | apps/agent | `fra` (EU) |

`docs/ARCHITECTURE.md` §6 requires **hard** pinning: an EU-pinned org's compute must never be
schedulable in the US, and its transcripts must never transit US infrastructure. A single Fly app
with a `regions` list is a *preference* for the scheduler, not a guarantee — during a capacity
crunch it can still place a machine somewhere else. Two fully separate apps, each with every machine
explicitly created with `--region`, is the only way to make the constraint structural rather than
best-effort. `Organization.dataRegion` (`US` | `EU`) is what apps/api's routing layer should use to
pick which pair of apps a given org's traffic goes to — wiring that routing decision is a follow-up,
not part of this spec.

---

## The two autoscaling strategies

**`apps/api` — Fly's native request-concurrency autoscaling.** It's stateless
(`docs/ARCHITECTURE.md` §5), so `infra/fly/api-{us,eu}.toml`'s `[http_service.concurrency]` block
(`soft_limit`/`hard_limit` per machine, `auto_start_machines`/`auto_stop_machines`) is Fly's built-in
mechanism — no extra tooling needed. Fly's own edge proxy is the load balancer.

**`apps/agent` — a custom-metric autoscaler.** Per `docs/ARCHITECTURE.md` §4: *"Scale on
sessions_concurrent / worker_capacity, not CPU — the workers are I/O bound and CPU stays flat while
the paid connections pile up."* There's no HTTP request signal to hook a native autoscaler to (job
dispatch is over LiveKit's own protocol), so this uses
[superfly/fly-autoscaler](https://github.com/superfly/fly-autoscaler), a separately-run process that
polls a metric and adjusts machine count via the Fly Machines API. The metric:

1. `apps/agent/src/livekit-worker.ts` calls `packages/shared/src/scaling/concurrency-counter.ts`'s
   `acquire()`/`release()` around each session's lifecycle — a Redis sorted set, fleet-wide, TTL-
   bounded so a crashed worker's entry self-heals instead of leaking (see that file's doc comment).
2. `apps/agent/src/metrics-server.ts` exposes `avatrain_sessions_concurrent` and
   `avatrain_worker_capacity` as Prometheus gauges on `:9091/metrics` on every machine (the same
   fleet-wide value from every machine — see its doc comment on why `max()`/`avg()`, not `sum()`).
3. `infra/fly/agent-{us,eu}.toml`'s `[metrics]` block is what makes Fly's built-in scraper pick that
   up automatically every ~15s, queryable at `https://api.fly.io/prometheus/<org-slug>`.
4. `infra/fly/autoscaler-agent-{us,eu}.yml` is what `fly-autoscaler` reads: it queries that
   Prometheus endpoint and computes `ceil((sessions_concurrent / worker_capacity) / 0.7)` — the
   `/ 0.7` is the ~30% headroom `docs/ARCHITECTURE.md` §4 calls for.

`fly-autoscaler`'s config schema is verified against
[its own reference file](https://github.com/superfly/fly-autoscaler/blob/main/etc/fly-autoscaler.yml)
as of writing — re-check that file before editing `infra/fly/autoscaler-agent-*.yml` by hand, it's an
external tool this codebase doesn't control the API of.

---

## Provisioning (one-time, per region)

Postgres and Redis are **Fly-native managed services** (Fly Managed Postgres, Upstash-backed Fly
Redis) — one vendor relationship, not a third-party add-on:

```bash
# Postgres (pgvector enabled at creation — required, see docs/ARCHITECTURE.md §5)
fly mpg create --name avatrain-pg-us --region iad --plan launch --pgvector
fly mpg attach <cluster-id> -a avatrain-api-us     # sets DATABASE_URL via a pooled connection
fly mpg attach <cluster-id> -a avatrain-agent-us   # avatrain-agent-* needs this too — see below

# Redis (Upstash-backed) — separate per region, same residency rationale as the compute split above
fly redis create   # interactive: name, primary region iad, org
fly redis status avatrain-redis-us   # get the connection string, then:
fly secrets set REDIS_URL=<connection-string> -a avatrain-api-us
fly secrets set REDIS_URL=<connection-string> -a avatrain-agent-us
```

**`avatrain-agent-*` needs `DATABASE_URL`/`APP_DATABASE_URL` too, not just `avatrain-api-*`** — it
doesn't touch Postgres in its own logic, but it imports `@avatrain/shared`'s root barrel, which
transitively constructs a `PrismaClient` at import time regardless of which named export the
importer actually uses. Confirmed by actually booting the built image without it (crashes on start
with `@prisma/client did not initialize yet`) — see "Local validation" below for the full finding.

`APP_DATABASE_URL` (the unprivileged RLS-enforcing role — `.claude/rules/tenancy.md`) needs the
`prisma/migrations/*_app_role_rls` migration applied against each region's cluster; `fly mpg attach`
only sets `DATABASE_URL` (the pooled/owner connection) as a secret, it doesn't run migrations or
create that role.

Repeat for `-eu` with `--region fra` and a separate Postgres cluster / Redis instance — **do not**
share one Postgres cluster or Redis instance across regions, that reintroduces exactly the
cross-region data transit §6 forbids.

Read replica: `docs/ARCHITECTURE.md` §5 requires one for analytics queries so they never compete with
session-bootstrap traffic on the primary. Fly Managed Postgres's replica support should be
re-checked against `fly mpg --help` at provisioning time — it wasn't confirmed as part of writing
this doc; if unavailable, this is a blocker to flag before Phase 8 load testing, not something to
work around silently.

---

## Deploying

Manual only, via `.github/workflows/deploy.yml`'s `workflow_dispatch` (a GitHub Environment approval
gate sits in front of it — see that file). Locally, from the repo root:

```bash
fly deploy . --config infra/fly/api-us.toml   --dockerfile apps/api/Dockerfile   --region iad
fly deploy . --config infra/fly/agent-us.toml --dockerfile apps/agent/Dockerfile --region iad
```

The working directory (`.`) must be the repo root — both Dockerfiles need the full pnpm workspace as
build context (see their header comments), not just their own `apps/*` directory.

First deploy of each `agent-*` app also needs a baseline machine count before `fly-autoscaler` has
anything to adjust — see the comment atop `infra/fly/agent-us.toml`.

---

## Local validation before a real deploy

```bash
docker build -f apps/api/Dockerfile   -t avatrain-api:local   .
docker build -f apps/agent/Dockerfile -t avatrain-agent:local .
```

**Verification status**: both images were built end-to-end and boot-tested against this repo's real
monorepo and this machine's local `docker-compose.yml` stack (real Postgres + Redis, not mocks) —
`docker run` each, hit the real endpoints, confirmed working:

- `avatrain-api:local` — `GET /healthz` → `{"status":"ok"}` (200), `GET /readyz` → `{"status":"ready"}`
  (200, real DB round-trip + Redis ping both succeeded).
- `avatrain-agent:local` — booted, logged `starting worker` / attempted its LiveKit connection (fails
  against a dummy URL, as expected — that's not what this was testing), `GET :9091/metrics` returned
  both Prometheus gauges.

That pass caught and fixed two real, non-obvious problems, both now baked into both Dockerfiles:

1. **Missing native-build toolchain / OpenSSL.** No `python3`/`make`/`g++` (some transitive deps,
   e.g. `msgpackr-extract` via `@livekit/agents`, node-gyp-compile a native addon on install) and no
   `openssl` (Prisma's query-engine target detection) in the base `node:20-bookworm-slim` image —
   `apt-get install`ed in both stages now.
2. **`pnpm deploy` doesn't carry over the *generated* Prisma client.** It only copies
   `@avatrain/api`/`@avatrain/agent`'s own declared dependency graph — `@prisma/client`'s generated
   output (the actual query-engine binary + client code, as opposed to the unbuilt placeholder stub
   the npm package ships) lives outside that graph and isn't reproduced. Booting the un-fixed image
   crashed immediately with `@prisma/client did not initialize yet`. The fix (see both Dockerfiles'
   builder-stage comments) regenerates the client after `pnpm deploy`, placed specifically where
   `@avatrain/shared`'s own Node module resolution will actually find it — verified against the
   built image's real `node_modules` layout, not assumed. `prisma generate` resolves `@prisma/client`
   via the `--schema` file's own directory, not `cwd`, which is what made this fiddly to get right.

The `avatrain-agent-*` / Postgres coupling noted under "Provisioning" above is pre-existing coupling
in `packages/shared`'s export structure (its root barrel re-exports `db/client.ts`, which constructs
a `PrismaClient` at import time regardless of which named export a caller actually wants), not
something introduced by this spec. Fixing it — e.g. splitting the barrel so DB-touching and DB-free
exports don't share one side-effecting module — is a separate, real cleanup worth doing but out of
scope here.

---

## Reliability, alerting, and backups

See `docs/adr/0007-reliability-alerting-strategy.md` for the full rationale;
`.claude/specs/reliability-uptime-disaster-recovery.md` for scope. Summary of what changed here:

**New secrets, per app:**

| Secret | Apps | Purpose |
|---|---|---|
| `SENTRY_DSN` | `avatrain-api-*`, `avatrain-agent-*` | Error tracking + alerting. Optional — both apps run with logging/error-tracking as a no-op if unset (`packages/shared/src/observability/sentry.ts`). |
| `INTERNAL_OPS_TOKEN` | `avatrain-api-*` | Gates `POST/PATCH /v1/internal/*` (uptime-check ingestion, incident CRUD). Also needed as a **GitHub Actions** repo secret, for `.github/workflows/synthetic-uptime-check.yml`. Optional at the app level too — those routes fail closed (503) rather than the app failing to boot when it's unset, see `apps/api/src/routes/internal.ts`. |

```bash
fly secrets set SENTRY_DSN=<dsn> -a avatrain-api-us
fly secrets set INTERNAL_OPS_TOKEN=<32+ char random token> -a avatrain-api-us
# repeat per app (avatrain-api-eu, avatrain-agent-us, avatrain-agent-eu — agent only needs SENTRY_DSN)
```

**New `/metrics` on `apps/api`** (`infra/fly/api-{us,eu}.toml`'s new `[metrics]` block) — same
hand-rolled Prometheus format as `apps/agent`, exposing `avatrain_api_up` and
`avatrain_api_error_count_total`. Unlike the agent, this is a Fastify route on the app's existing
port (4000), not a second `http.createServer`.

**Status page**: `GET https://avatrain-api-<region>.fly.dev/status` (human-readable) and
`GET .../v1/status` (JSON) — self-hosted, see `docs/adr/0007`'s tradeoff on what happens if both
regions are down simultaneously.

**Synthetic uptime checks**: `.github/workflows/synthetic-uptime-check.yml`, every 5 minutes, from
GitHub's infra (deliberately outside Fly) — only checks `apps/api`'s two regions, since
`avatrain-agent-*` has no public `[http_service]` at all. See `scripts/report-uptime-check.mjs`.

**Backup verification**: `.github/workflows/backup-verification.yml`, weekly — restores the latest
Fly Managed Postgres backup to a scratch instance and sanity-checks it. **The exact `fly mpg`
backup/restore command surface used there was never confirmed against a live Fly account** — same
open item as the read-replica gap two sections up. Confirm both against real `fly mpg --help` output
at the same time, before trusting either. See `docs/runbooks/postgres-restore.md`.
