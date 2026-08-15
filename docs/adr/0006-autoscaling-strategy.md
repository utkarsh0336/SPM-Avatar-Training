# ADR-0006: Autoscaling strategy

`docs/ARCHITECTURE.md` §7 reserves ADR-0001 through 0005 for decisions already implicit in
`CLAUDE.md` but not yet written up. This is the first ADR actually written for this repo, numbered
0006 because it's a new decision, not one of those five — the earlier five remain unwritten.

## Status

Accepted, implemented in `.claude/specs/auto-scaling.md`.

## Context

Nothing in this repo committed to a cloud provider or orchestration platform before this decision —
the only deployment artifact was a local `docker-compose.yml`. `docs/ARCHITECTURE.md` §4–§5 already
specify *what* to scale on (`apps/api` on request concurrency, `apps/agent` on
`sessions_concurrent / worker_capacity`, explicitly not CPU) without specifying *how* or *where*.

## Decision

**Fly.io, not Kubernetes/a hyperscaler.** Kubernetes (EKS/GKE/AKS) plus Terraform was the initial
draft of this spec; it was replaced after confirming the actual constraint that matters here —
`apps/agent` needs a custom-metric autoscaler, not CPU/memory HPA, since it's I/O-bound and CPU stays
flat under load. Fly.io's Machines API plus `superfly/fly-autoscaler` supports scaling on an
arbitrary Prometheus query out of the box; a from-scratch Kubernetes setup would need KEDA (or a
hand-rolled controller) to get the same capability, plus a full cluster (networking, node pools,
IAM) this platform doesn't otherwise need. Less infrastructure to own for the same scaling
capability.

**Two Fly apps per service (one per region), not one app with a `regions` list.** See
`infra/README.md`'s "Why four apps, not one" — `docs/ARCHITECTURE.md` §6 requires hard regional
pinning, and a single app's `regions` list is a scheduler preference, not a guarantee.

**Fly-native services (Managed Postgres, Upstash-backed Redis), not a third-party partner
(Supabase/Neon).** Fly's own Managed Postgres now supports `pgvector` as a first-class flag
(`fly mpg create --pgvector`), confirmed at the time this ADR was written — this used to require a
third-party partner integration and no longer does. One vendor relationship instead of two.

## Consequences

- `apps/agent` gains an HTTP surface it didn't have before (`:9091/metrics`,
  `apps/agent/src/metrics-server.ts`) purely for Fly's scraper — it's still not an HTTP *service* in
  the request-handling sense; nothing about job dispatch changes.
- The autoscaling signal (`sessions_concurrent`) now depends on Redis being reachable from every
  worker machine in a region. `concurrency-counter.ts`'s `acquire()`/`release()` fail open specifically
  so this dependency can never take down a learner's session, only degrade the autoscaler's signal
  quality — see that file's doc comment.
- If a future requirement needs true Kubernetes (e.g. a customer's compliance posture demands
  self-hosted/on-prem, called out as deliberately deferred in `docs/ROADMAP.md`), this decision gets
  revisited — nothing above is Fly-specific at the design-intent level (scale on
  `sessions_concurrent / worker_capacity`, hard region pinning, fail-open counters), only the
  concrete tooling is.
