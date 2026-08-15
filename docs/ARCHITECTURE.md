# Architecture — deep reference

Companion to `CLAUDE.md`. Read this when the task touches transport, session lifecycle, failure
handling, or scaling. Everything here assumes you already know §4–§6 of `CLAUDE.md`.

---

## 1. Session state machine

The widget is a state machine, not a pile of booleans. Implement it as one in
`packages/realtime-core/src/session-machine.ts`.

```
             ┌──────────┐
             │   idle   │◄──────────────────────────────┐
             └────┬─────┘                               │
        open()    │                                     │
             ┌────▼──────────┐   fail    ┌──────────────┴───┐
             │ bootstrapping │──────────►│ error(recoverable)│
             └────┬──────────┘           └──────────────┬───┘
   creds + config │                          retry ▲    │ fatal
             ┌────▼──────────┐                     │    ▼
             │  connecting   │─────────────────────┘  ┌────────┐
             └────┬──────────┘                        │ ended  │
        connected │                                   └────────┘
             ┌────▼──────────┐  speech_started   ┌──────────────┐
             │   listening   │◄─────────────────►│  learner_    │
             └────┬──────────┘                   │  speaking    │
       response   │                              └──────────────┘
             ┌────▼──────────┐  barge-in ──────────────┐
             │   speaking    │─────────────────────────┘
             └────┬──────────┘
      tool call   │
             ┌────▼──────────┐
             │   thinking    │  ← avatar shows a thinking expression + filler line
             └───────────────┘
```

Invariants worth asserting in dev builds:

- `speaking` and `learner_speaking` are never both true. If they are, barge-in handling is broken.
- Every transition into `thinking` must emit a filler utterance within 250ms or the learner
  experiences dead air.
- `ended` is terminal. Reconnects create a new session id; never resurrect an ended one, or billing
  and progress attribution both go wrong.

---

## 2. Failure modes and recovery

| Failure | Detection | Recovery | Learner sees |
|---|---|---|---|
| Ephemeral token expired before SDP | 401 from `/v1/realtime/calls` | Re-mint once, retry | Nothing (sub-second) |
| ICE fails / no candidates | `iceConnectionState = failed` | Retry with TURN relay forced; then fall back to Mode B | "Reconnecting…" |
| Mic permission denied | `getUserMedia` rejects | Switch to text input mode | Clear how-to-enable panel |
| Network drop mid-session | `connectionState = disconnected` | Buffer state, reconnect ≤ 3 attempts with backoff, replay last objective context | "Reconnecting…" then resume |
| OpenAI 429 / 5xx | Error event on data channel | Backoff, then degrade to text chat with the same tutor logic | "High demand — switching to text" |
| Avatar provider fails (Mode B) | No video track after 5s | Degrade renderer to `mesh3d`, keep audio | Avatar changes appearance, session continues |
| WebGL context lost | `webglcontextlost` | Degrade to `voiceOnly` | Waveform replaces avatar |
| Tool timeout (>4s) | AbortSignal | Tell the model the tool failed; avatar apologises and offers escalation | Natural spoken recovery |
| Turn TTFA over budget (>1400ms mediated) | `turn-latency-guard.ts` watchdog (`TURN_TTFA_BUDGET_MS`) | `latency.budget_exceeded` sent, turn continues; after 3 consecutive over-budget turns for an org, in-process circuit breaker skips retrieval and forces fallback-first TTS until a turn comes in under budget | Nothing blocking — turn completes as normal |

**Degrade, never drop.** Every failure above has a path that keeps the learner learning. A session
that ends because a video provider hiccuped is a bug, not an outage.

Reconnect must restore *pedagogical* context, not the full transcript: current objective, last
question asked, attempts so far. Replaying 20 turns of audio history is slow and expensive; a
150-token state summary is enough and costs nothing.

---

## 3. Where each piece of state lives

| State | Home | Lifetime |
|---|---|---|
| WebRTC peer connection | Widget memory | Session |
| Conversation history | OpenAI session (Mode A) / agent process (Mode B) | Session |
| Pedagogical state (objective, attempts) | Postgres, written through `record_progress` | Permanent |
| Session credentials | Widget memory only | 60s |
| Quotas, concurrency counters | Redis | Rolling window |
| Transcript | Postgres, redacted at write | `retentionDays` |
| Audio | Discarded unless `recording.enabled` | Session or retention |

The rule that follows: **the browser is never the source of truth for anything billable or
gradeable.** It holds media and ephemeral UI state. That is all.

---

## 4. Mode B agent worker lifecycle

```
worker boots → registers with LiveKit → idle
  ↓ job dispatch (room created by POST /v1/sessions)
join room → WAIT for a non-agent participant   ← cost gate, do not skip
  ↓ human present
start AgentSession(RealtimeModel, tools)
start AvatarSession(provider) → publishes video track
  ↓ conversation
on last human leaves OR idle > AGENT_IDLE_TIMEOUT_MS OR duration > AGENT_MAX_SESSION_MS
  → stop avatar, close model session, emit usage, leave room
```

Scale on `sessions_concurrent / worker_capacity`, not CPU — the workers are I/O bound and CPU stays
flat while the paid connections pile up. Target ~30% headroom; a queued learner staring at a
spinner has already churned.

Workers are stateless between jobs. Never cache tenant data in worker memory across sessions — that
is how cross-tenant leaks happen in a process that outlives a single tenant's session.

---

## 5. Scaling notes

- **`apps/api` is stateless** → horizontal, behind a load balancer. The only sticky thing is
  nothing; keep it that way.
- **Postgres**: read replicas for analytics queries. Never run dashboard aggregations against the
  primary that also serves session bootstrap — bootstrap is on the latency path.
- **pgvector**: HNSW index; partition `KnowledgeChunk` by `org_id` past ~10M rows. Retrieval must
  stay under 100ms p95 or it needs a filler utterance.
- **Redis**: quotas and counters only. If you find yourself putting session truth in Redis, the
  design has drifted.
- **CDN**: `embed.js` is immutable per version (`/v1/embed.<hash>.js`) with a long TTL, fronted by a
  short-TTL `/v1/embed.js` pointer. Never bust cache on the loader itself — customers have it in
  their HTML and you cannot redeploy their pages.

---

## 6. Multi-region

`Organization.dataRegion` pins storage. Compute follows data: an EU-pinned org's sessions must
bootstrap against the EU API and EU agent workers, and its transcripts must never transit US
infrastructure. Route at the edge on the publishable key, before the request reaches an app server.

OpenAI edge selection is not ours to control, which is why the ~30–80ms network legs in the latency
budget are listed as fixed cost rather than something to optimise.

---

## 7. Architecture decision records

Keep ADRs in `docs/adr/NNNN-title.md`. The ones that already exist implicitly in `CLAUDE.md` and
should be written up properly before Phase 2:

- ADR-0001 Two transport modes rather than one universal mediated path
- ADR-0002 `mesh3d` as the default renderer rather than a photoreal provider
- ADR-0003 iframe isolation rather than Shadow-DOM-only embedding
- ADR-0004 Postgres + pgvector rather than a dedicated vector database
- ADR-0005 Server-only tools for grading and progress

ADR-0006 (`docs/adr/0006-autoscaling-strategy.md`) and ADR-0007
(`docs/adr/0007-reliability-alerting-strategy.md`) are already written — new decisions, not backfills
of the list above.

---

## 8. Reliability, alerting, and status

Full rationale: `docs/adr/0007-reliability-alerting-strategy.md`. Operational reference:
`infra/README.md`'s "Reliability, alerting, and backups" section and `docs/runbooks/`.

- **Structured logging + error tracking**: Pino (via Fastify's own `logger` option in `apps/api`,
  and `packages/shared/src/observability/logger.ts` in `apps/agent`) and `@sentry/node`
  (`packages/shared/src/observability/sentry.ts`), both optional — a true no-op with no `SENTRY_DSN`
  set, so local dev/CI need no config changes. Confined to `apps/api`/`apps/agent`; never in
  `apps/widget`/`packages/embed` (Phase 4's `≤10KB gzipped, zero dependencies` embed budget).
- **Alerting**: one pipeline — Sentry's own issue-alert rules (email, this pass). Both application
  errors and synthetic-check failures report through the same `Sentry.captureException`/
  `captureMessage` call sites, not two separate systems.
- **Status page**: `GET /status` (human) / `GET /v1/status` (JSON), served directly by `apps/api`,
  reflecting `UptimeCheck`/`StatusIncident` — both global, RLS-exempt Prisma models (platform state,
  not tenant data, same reasoning as `User`/`OAuthAccount`). Self-hosted rather than a third-party
  vendor; unreachable only if both `apps/api` regions are down simultaneously (see §6 above — they
  are genuinely independent Fly apps, so a single-region outage doesn't take the page down).
- **Synthetic checks**: `.github/workflows/synthetic-uptime-check.yml`, running from outside
  Avatrain's own infra. Covers `apps/api`'s two regions only — `apps/agent` has no public HTTP
  surface to check from the outside; its liveness stays covered by the existing internal Prometheus
  scrape feeding `fly-autoscaler` (§5 above), unchanged by this section.
- **Backup/DR**: `.github/workflows/backup-verification.yml` restores the latest Fly Managed
  Postgres backup to a scratch instance and sanity-checks it, on a schedule — a policy nobody has
  restored isn't disaster recovery. Per §6's region pinning, a restore always stays within its
  source region; there is no cross-region failover for tenant data, by design, documented in
  `docs/runbooks/region-failover.md`.