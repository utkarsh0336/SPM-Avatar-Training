# Runbook: Postgres restore

Companion to `.github/workflows/backup-verification.yml`, which exercises this exact procedure on a
schedule against a disposable scratch instance. **Read that workflow's file header before running any
command below by hand** — it documents the same open item this runbook inherits: the precise
`fly mpg` backup/restore command surface was never confirmed against a live Fly account. Treat every
`fly mpg ...` command below as a best-effort placeholder, not verified fact, until checked against
real `flyctl` output.

## When to use this

Data loss or corruption on a region's primary Postgres cluster — not a transient connectivity blip
(`GET /readyz` failing alone doesn't mean this; check `docs/runbooks/incident-response.md` first).

## Hard constraint: never cross regions

Per `docs/ARCHITECTURE.md` §6, an EU org's data must never transit US infrastructure, and vice versa.
**Always restore a region's backup into a cluster in the same region.** `avatrain-pg-us`'s backups
restore only to a new US cluster; `avatrain-pg-eu`'s only to a new EU cluster. There is no
cross-region failover for tenant data — see `docs/runbooks/region-failover.md`.

## Procedure

1. **Do not restore directly onto the live cluster first.** Always restore to a new scratch cluster,
   verify it, and only then decide how to cut traffic over — an in-place restore that turns out wrong
   has no undo.

   ```bash
   fly mpg backup restore --org avatrain --name avatrain-pg-us-restore-<date> --latest \
     --region iad   # or fra for the EU cluster — must match the source region
   ```

2. **Sanity-check the restored data** before treating it as usable — the same check
   `backup-verification.yml` runs automatically:

   ```bash
   fly mpg connect --app avatrain-pg-us-restore-<date> \
     --command "SELECT count(*) FROM organizations;"
   ```

   A restore that "succeeds" but returns an empty/corrupt database is worse than an obvious failure —
   it looks safe and isn't.

3. **Cut over.** Point the affected app(s) at the restored cluster (`fly mpg attach` the new cluster
   to `avatrain-api-<region>` / `avatrain-agent-<region>`, matching `infra/README.md`'s Provisioning
   section for how both apps get `DATABASE_URL`/`APP_DATABASE_URL`). Confirm `GET /readyz` passes
   against the new cluster before declaring the incident resolved.

4. **Do not delete the original (corrupted) cluster immediately** — keep it available for forensics
   until the incident's root cause is understood, then clean it up as a separate, deliberate step.

## After

Update the incident via `docs/runbooks/incident-response.md`'s step 4, and confirm
`docs/adr/0007-reliability-alerting-strategy.md`'s backup-retention assumptions still hold given
whatever caused this — if they don't, that's a decision to revisit, not silently patch over.
