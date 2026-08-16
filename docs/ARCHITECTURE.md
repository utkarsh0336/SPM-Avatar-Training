# Architecture — deep reference

Companion to `CLAUDE.md`. Read this when the task touches transport, session lifecycle, failure
handling, or scaling. Everything here assumes you already know §4–§6 of `CLAUDE.md`.

---

## 1. Session transport and status flow

**This is a plain WebSocket, not WebRTC/OpenAI Realtime.** The default (Mode A) path is
`apps/api`'s `GET /v1/conversations/:trainingSessionId/ws` — auth is a 60s single-use ticket minted
via `POST /v1/conversations/ticket` and passed as `?ticket=` (browsers can't attach a cookie/header to
a cross-origin WS handshake). There is no SDP offer/answer and no ICE negotiation on this path; STT,
LLM, and TTS all run server-side in `apps/api/src/services/conversation-service.ts`, streamed back
over the same socket as sentence-chunked `tts.chunk` messages. See `.claude/rules/realtime.md` for the
authoritative transport rules. (Mode B/LiveKit, §4 below, is the one place real WebRTC still applies —
gated to Enterprise-plan orgs.)

The client side (`packages/realtime-core/src/conversation-session.ts`,
`connectConversationSession()`) is **not** a state machine with named states/guards — it's a flat
status union driven by ~13 `setStatus()` call sites scattered through the WS message handlers and VAD
callbacks:

```ts
type ConversationSessionStatus = "connecting" | "listening" | "thinking" | "speaking" | "error" | "ended";
```

Rough flow: `connecting` (WS open) → `listening` (`session.ready`, or VAD detects speech and starts
recording) → `thinking` (speech ends, audio sent) → `speaking` (`turn.started`/`tts.chunk` streaming
back) → `listening` again (`turn.ended` once playback drains, or `session.ready`). `error` fires on an
unexpected WS `close` or a caught exception mid-turn — there is no `error(recoverable)` vs. fatal
split; every error is the same status, and there is currently **no automatic reconnect** (see §2).
`ended` is set once, last, by `disconnect()`, guarded by an internal `ended` boolean checked before
every subsequent `setStatus()` call — so in practice nothing fires after it, even without a formal FSM
enforcing that.

There is no literal `learner_speaking` status. The doc's original invariant — the avatar and the
learner are never both "speaking" — is enforced differently: `barge-in-controller.ts` stops local
avatar playback synchronously the instant VAD detects learner speech, and a monotonic
`currentUtteranceId` guard drops any late-arriving audio from the turn that just got interrupted. The
"thinking → filler within 250ms" behavior described here previously does not exist in code; there is
no filler-utterance mechanism today.

---

## 2. Failure modes and recovery

| Failure | Detection | Recovery | Learner sees |
|---|---|---|---|
| WS ticket invalid/expired/reused | 401 in the `/ws` route's `preValidation` hook, before upgrade completes | **Gap**: no client-side re-mint-and-retry exists today | Generic "Couldn't start the session" message |
| WS closes unexpectedly mid-session | `close` event fires before `disconnect()` was called | `setStatus("error")` only — **gap**: no reconnect/backoff exists today | Session shows an error state; learner must restart |
| Mic permission denied / no track | `getUserMedia` rejects, or resolves with no audio track | Caught in `useEmbedSession.ts`'s connect try/catch | Generic "Couldn't start the session. Please try again." — **not** a distinct how-to-enable panel |
| Server STT unavailable | `stt.failed` message from the server | Latches to client-side Web Speech recognition (`recognizeOnce`) for the rest of the session | Nothing blocking — turn continues |
| Retrieval slow or failing | `withRetrievalTimeout()` in `conversation-service.ts` | Degrades the turn to ungrounded generation | Nothing blocking |
| Tool call slow or failing (timeout) | `withToolTimeout()` (`AbortSignal`) in `conversation-service.ts` | Model is told the call failed; continues the turn | Natural spoken recovery |
| Curriculum / avatar-record lookup fails | try/catch around the lookup in `conversation-service.ts` | Degrades to "no curriculum this session" / "no persona override" | Nothing blocking |
| Barge-in (learner speaks over the avatar) | VAD detects speech during playback | Client stops local playback synchronously first, then fire-and-forget notifies the server (`barge_in`); server aborts the in-flight LLM/TTS call via a per-turn `AbortController` | Avatar stops within the client-side budget (~300ms); server-side abort is best-effort, not part of that budget |
| Turn TTFA over budget (>1400ms) | `turn-latency-guard.ts` watchdog (`TURN_TTFA_BUDGET_MS`) | `latency.budget_exceeded` sent, turn continues; after 3 consecutive over-budget turns for an org, in-process circuit breaker skips retrieval and forces fallback-first TTS until a turn comes in under budget | Nothing blocking — turn completes as normal |
| Avatar/video provider fails (any of `vrm`/`simli`/`mock`) | **Not implemented** — no fallback-after-N-seconds renderer downgrade exists | — | — |
| WebGL context lost | **Not implemented** — no `webglcontextlost` handling exists | — | — |
| OpenAI (or other provider) 429/5xx on the server-side LLM/STT/TTS call | Provider-specific — not audited here | Not audited here; do not assume the old client-side "switch to text chat" behavior still applies, since there is no client-side OpenAI connection to fall back from | Unverified |

**Degrade, never drop** is still the real design intent — it shows up repeatedly as inline comments
across `conversation-service.ts` — but it is not yet true for every row above. The rows marked **Gap**
or **Not implemented** are real, current holes, not just missing detection. Treat this table as the
honest current state, not an aspiration; update a row to ✅ only once you've traced the actual recovery
path in code, the way the rows above were verified.

**Design target, not current behavior** (there is no reconnect logic today — see the table above):
once reconnect exists, it should restore *pedagogical* context, not the full transcript — current
objective, last question asked, attempts so far. Replaying 20 turns of audio history is slow and
expensive; a 150-token state summary is enough and costs nothing.

---

## 3. Where each piece of state lives

| State | Home | Lifetime |
|---|---|---|
| WS connection (Mode A) / WebRTC peer connection (Mode B only) | Widget memory | Session |
| Conversation history | `apps/api`'s `conversation-service.ts`, in-process (Mode A) / agent process (Mode B) | Session |
| Pedagogical state (objective, attempts) | Postgres, written through `record_progress` | Permanent |
| Session credentials | Widget memory only | 60s |
| WS/embed connection tickets | Redis, single-use | 60s |
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
- **Postgres**: read replicas for analytics queries is the design intent, **not yet built or
  verified** — Fly Managed Postgres read-replica support hasn't been confirmed against real `fly mpg`
  output (open item carried from the auto-scaling and reliability work). Today, dashboard aggregation
  queries and session bootstrap both hit the same primary. Never run dashboard aggregations against
  the primary that also serves session bootstrap once replicas exist — bootstrap is on the latency
  path.
- **pgvector**: HNSW index is real (see the migration that references this section). Partitioning
  `KnowledgeChunk` by `org_id` past ~10M rows is still just a target, not implemented. Retrieval must
  stay under 100ms p95 or it needs a filler utterance (no filler-utterance mechanism exists yet — see
  §1).
- **Redis**: quotas, counters, and single-use ephemeral auth tickets (60s TTL WS/embed connection
  tickets — a short-lived nonce, not session truth). If you find yourself putting session truth in
  Redis, the design has drifted.
- **CDN**: **not yet built.** `apps/api/src/routes/embed.ts` currently only serves `GET
  /v1/embed/config` (a JSON config lookup by publishable key) plus WS ticket minting — there is no
  versioned, immutable loader script route (`/v1/embed.<hash>.js`) or short-TTL pointer today. Keep
  the intent in mind when building it — never bust cache on the loader itself once it exists, since
  customers have it in their HTML and you cannot redeploy their pages — but don't assume it's live.

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
- ADR-0002 `vrm` as the default renderer rather than a photoreal provider (formerly drafted around a
  `mesh3d` renderer name — that name doesn't exist in code; the actual default provider is `vrm`, see
  `packages/avatar-core/src/avatar-provider-factory.ts`)
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
  are genuinely independent Fly apps, so a single-region outage doesn't take the page down) — **that
  guarantee currently only holds once `apps/api` is actually deployed to both Fly regions.** As of
  this writing it never has been, so `synthetic-uptime-check.yml`'s schedule is disabled (see below)
  and `UptimeCheck` rows aren't being freshly written; re-enable the schedule once a real `fly deploy`
  lands.
- **Synthetic checks**: `.github/workflows/synthetic-uptime-check.yml`, running from outside
  Avatrain's own infra. Covers `apps/api`'s two regions only — `apps/agent` has no public HTTP
  surface to check from the outside; its liveness stays covered by the existing internal Prometheus
  scrape feeding `fly-autoscaler` (§5 above), unchanged by this section.
- **Backup/DR**: `.github/workflows/backup-verification.yml` restores the latest Fly Managed
  Postgres backup to a scratch instance and sanity-checks it, on a schedule — a policy nobody has
  restored isn't disaster recovery. Per §6's region pinning, a restore always stays within its
  source region; there is no cross-region failover for tenant data, by design, documented in
  `docs/runbooks/region-failover.md`.