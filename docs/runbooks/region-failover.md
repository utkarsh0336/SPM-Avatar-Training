# Runbook: Region failover

## There is no cross-region failover for tenant data. This is by design, not a gap.

`docs/ARCHITECTURE.md` §6 and `docs/adr/0006-autoscaling-strategy.md` ("why four apps, not one")
establish hard regional pinning: an EU-pinned org's compute must never be schedulable in the US, and
its transcripts must never transit US infrastructure. `Organization.dataRegion` is not a preference —
it is a compliance/residency guarantee. **No runbook or automated recovery path may move an EU org's
data into US infra, or vice versa, under any circumstances, including "the EU region is fully down."**

If a customer's data-residency agreement requires surviving a full-region outage, that requires a
second EU-region deployment target (or a different residency commitment), which is a product/legal
decision, not something this runbook can authorize on its own.

## What "failover" means here

Per-region recovery only:

- **`avatrain-api-<region>` down**: this is a single Fly app among four
  (`infra/README.md`'s topology table) — the *other* region's API is unaffected and its `GET /status`
  continues to render correctly (`docs/adr/0007`'s status-page tradeoff). Investigate/restart/redeploy
  that specific app; see `.github/workflows/deploy.yml`.
- **`avatrain-agent-<region>` down**: sessions for that region degrade per
  `docs/ARCHITECTURE.md` §2's "Degrade, never drop" — investigate via Fly's own dashboard/logs for
  that app (this pass's synthetic-uptime-check doesn't cover apps/agent directly, see
  `docs/adr/0007`'s Consequences).
- **A region's Postgres cluster down/corrupted**: `docs/runbooks/postgres-restore.md` — restore
  within the same region only.
- **A region's Redis down**: per `docs/ARCHITECTURE.md` §3, Redis in this system holds only rolling/
  ephemeral state (quotas, concurrency counters) — nothing there is a source of truth. Provision a
  fresh Redis instance in the same region and re-point the affected app(s)' `REDIS_URL`; no restore
  needed, some in-flight scaling-signal accuracy is lost temporarily, not data.

## Both regions down simultaneously

An extreme, low-probability case. Per `docs/adr/0007`, `GET /status` itself becomes unreachable in
this scenario (both underlying `apps/api` instances are down) — there is no independently-hosted
fallback page in this pass. Communicate through whatever out-of-band channel is available (status
page vendor was explicitly deferred, see that ADR's Decision section) while working each region's
recovery independently per the sections above.
