# Runbook: Incident response

Companion to `docs/adr/0007-reliability-alerting-strategy.md`. What to do when a Sentry alert email
fires or `.github/workflows/synthetic-uptime-check.yml` reports a failure.

## 1. Confirm the alert

- Sentry email fires from either `apps/api/src/lib/http-errors.ts`'s `handleError` (an unexpected
  5xx) or `apps/api/src/services/status-service.ts`'s `recordUptimeCheck` (a synthetic check reported
  `DOWN`).
- Check `GET /status` (`https://avatrain-api-us.fly.dev/status` or `-eu`) for the current picture —
  it reflects the same `UptimeCheck`/`StatusIncident` rows, cached at most 15s
  (`apps/api/src/routes/status.ts`'s `CACHE_TTL_MS`).
- Check the Sentry issue itself for a stack trace / affected region.

## 2. Open an incident

Only if customer-visible (not every Sentry error warrants a public incident — use judgment). Requires
`INTERNAL_OPS_TOKEN` (a Fly secret on `apps/api`, also a GitHub Actions secret for the synthetic-check
workflow):

```bash
curl -X POST https://avatrain-api-us.fly.dev/v1/internal/incidents \
  -H "authorization: Bearer $INTERNAL_OPS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"title":"Elevated errors in US region","severity":"MAJOR","affectedRegions":["US"],"body":"Investigating."}'
```

This immediately appears on `GET /status` / `GET /v1/status`.

## 3. Investigate

- Region-specific issue (one of `avatrain-api-us`/`avatrain-api-eu`/`avatrain-agent-us`/
  `avatrain-agent-eu`)? See `infra/README.md` for the Fly app topology.
- Database issue? See `docs/runbooks/postgres-restore.md` — do **not** attempt a restore without
  reading that first; a restore is destructive to the scratch target and must never be pointed at a
  live cluster by accident.
- Full-region outage? See `docs/runbooks/region-failover.md` — read it before doing anything; the
  short version is there is no cross-region failover for tenant data, by design.

## 4. Update and resolve

```bash
curl -X PATCH https://avatrain-api-us.fly.dev/v1/internal/incidents/<incident-id> \
  -H "authorization: Bearer $INTERNAL_OPS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"body":"Root cause identified, fix deploying.","status":"IDENTIFIED"}'
```

Resolve the same way with `{"status":"RESOLVED"}` once confirmed — pair it with a final `body` update
summarizing what happened, since `GET /status` shows the full incident history, not just the current
state.

## 5. Postmortem

Not automated. If the incident was customer-visible, write one — this repo doesn't yet have a fixed
location/template for postmortems; use judgment on where it best fits alongside this doc.
