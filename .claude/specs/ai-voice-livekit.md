# Spec: AI Voice LiveKit

## Overview

This feature builds the LiveKit-mediated ("Mode B") voice and photoreal-avatar pipeline that powers **Enterprise-plan learners** interacting with the AI avatar trainer through the **embedded widget** on a customer's website — as distinct from the default "Mode A" path, where the widget connects directly to the OpenAI Realtime API over WebRTC.

Concretely, this spec covers three things:

1. The `apps/agent` LiveKit worker: the process that joins a LiveKit room on behalf of the avatar, waits for a real learner before doing anything billable, runs the OpenAI Realtime model server-side, drives a photoreal avatar provider, and tears itself down cleanly.
2. The avatar-provider adapter: the interface that lets a LiveKit-video-track-backed ("stream") avatar renderer plug into `packages/avatar-core` alongside the (not-yet-built) `mesh3d` renderer, without either package depending on the other's transport.
3. LiveKit credential minting: the `apps/api` endpoint that creates a LiveKit room and hands the widget a scoped, short-lived join token.

It deliberately does **not** build a full learner-facing voice pipeline end to end — see "Depends On" below. It also does **not** touch `.claude/specs/video-chat-session.md`'s territory, which is a separate, already-designed system for *trainers* rehearsing with their own avatar inside the dashboard.

---

## Business Goal

Photoreal avatar rendering (lip-synced video, not a 3D mesh) requires a server in the loop compositing and publishing a video track — it cannot happen in a pure browser-to-OpenAI WebRTC connection. That server-mediated pipeline is expensive to run per-minute, so it is gated to the Enterprise plan tier and only started once a real learner is present (never pre-warmed speculatively). This is the concrete product capability that justifies the Enterprise price point over the Starter/Pro tiers, which get the cheaper, still-good `mesh3d` avatar over Mode A.

---

## Depends On

This spec has **hard, currently-unmet dependencies**. It can be merged and reviewed as a design, but the code it introduces is inert (feature-flagged off) until these land:

- **Phase 1 — Mode A voice skeleton** (`docs/ROADMAP.md`). `packages/realtime-core/src/session-machine.ts` does not exist yet (only the ASCII lifecycle diagram in `docs/ARCHITECTURE.md` §1). `packages/realtime-core/src/events.ts`'s `REALTIME_EVENTS` is a deliberately empty const. No `ek_*` ephemeral-token minting exists anywhere in the codebase. This spec's `connect` endpoint's Mode A branch is a documented stub (`notImplemented`) — it is not this spec's job to build Mode A, only to not silently fake it.
- **Phase 2 — Avatar** (`docs/ROADMAP.md`). `packages/avatar-core` currently exports only the `AvatarRenderer` interface — no `mesh3d` implementation exists. The mid-session "stream avatar fails → degrade to mesh3d" path (required by `docs/ARCHITECTURE.md` §2's failure table and Phase 6's own exit criteria) can only be defined at the interface/signal level here; it cannot be built or tested end-to-end until `mesh3d` exists.
- **Phase 4 — Embeddable** (`docs/ROADMAP.md`). `packages/embed/src` and `apps/widget/src` have no session, identity-JWT, or origin-allowlist infrastructure at all today (`apps/widget/src/App.tsx` is a literal placeholder). The endpoints this spec adds are unsafe for real production learner traffic without that layer — enforced by shipping the route behind `FEATURE_MODE_B_ENABLED`, default `false`.
- **No photoreal avatar-video vendor is chosen anywhere in the repo or docs.** This spec defines the `AvatarProvider` interface and a `null-provider` test double (never publishes video — used to exercise the degrade path deterministically), not a real vendor integration. Picking a vendor and wiring its SDK is a follow-up requiring its own dependency approval.
- `Organization.plan` does not exist in `prisma/schema.prisma` today. This spec adds a minimal enum with no self-serve upgrade flow or Stripe linkage (that's Phase 7 — Money).

Per `docs/ROADMAP.md`'s own rule ("Do not start phase N+1 while phase N's exit criterion is unmet"), formal implementation of this spec should not begin until Phases 1, 2, and 4's exit criteria are met, or an explicit, scoped exception is agreed with whoever owns the roadmap.

Not a dependency of this spec, but adjacent and worth noting: `.claude/specs/video-chat-session.md` already designed a `TransportMode { MODE_A_DIRECT, MODE_B_LIVEKIT }` enum and a `connect`-endpoint credential contract — but scoped entirely to the dashboard's `TrainingSession` model (trainer rehearsal, `/v1/training-sessions/*`). This spec reuses the *shape* of that enum for consistency but defines its own `LearnerSession` model under a separate `/v1/sessions/*` namespace (reserved for exactly this purpose per `docs/ARCHITECTURE.md` §1) to avoid colliding with that spec's ownership. If both specs' Prisma migrations are implemented, whichever lands second should reuse the first's `TransportMode` enum rather than redeclaring it.

---

## Components Affected

- `apps/agent` — primary: real worker implementation replacing the current stub.
- `apps/api` — new `/v1/sessions` routes and LiveKit token minting.
- `packages/avatar-core` — additive `StreamAvatarRenderer` interface alongside the existing `AvatarRenderer`.
- `packages/shared` — new `learner-session` schema module and shared LiveKit constants.
- `prisma` — new `LearnerSession` model, additive `Organization.plan`.

Explicitly **not affected**: `apps/widget`, `apps/dashboard`, `packages/embed`. These are the future consumers of this spec's contract (widget-side LiveKit room join, UI, identity verification) and are out of scope — see "Depends On."

---

## API Changes

### `POST /v1/sessions`

Creates a `LearnerSession`.

- Request: `{ publishableKey: string, clientRequestId: string }`
- Resolves the `Application` by `publishableKey` (unauthenticated bootstrap lookup — same "resolve identity before org context" pattern `auth-service.ts` already uses for login), then the owning `Organization`, then `transportMode` from `Organization.plan` (`ENTERPRISE` → `MODE_B_LIVEKIT`, everything else → `MODE_A_DIRECT`).
- `clientRequestId` is an idempotency key: `@@unique([orgId, clientRequestId])` on `LearnerSession`, mirroring `TrainingSession`'s existing pattern in `video-chat-session.md`.
- Response: `201 { learnerSession: { id, status, transportMode, startedAt } }`.

### `POST /v1/sessions/:id/connect`

Mints transport credentials for an existing `LearnerSession`.

- Request: `{}`.
- **Mode B (`MODE_B_LIVEKIT`) response** — the real payload this spec implements:
  ```json
  {
    "transportMode": "MODE_B_LIVEKIT",
    "credentials": {
      "livekitUrl": "wss://...",
      "roomToken": "...",
      "roomName": "ls_<learnerSessionId>"
    }
  }
  ```
  - Creates the LiveKit room idempotently via `RoomServiceClient.createRoom({ name: roomName, metadata: JSON.stringify({ orgId, applicationId, learnerSessionId }), agents: [{ agentName: LIVEKIT_AGENT_NAME }] })`. The `agents` field requests **explicit dispatch** — the worker fleet only receives jobs for rooms `apps/api` intentionally created for a real session, which is itself a cost-control boundary, not just wiring.
  - Mints an `AccessToken` scoped to exactly that room (`roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true`), with a random opaque `identity` (never learner PII). TTL: `LIVEKIT_TOKEN_TTL_SECONDS` (default 300s — longer than Mode A's 60s `ek_*` budget, to tolerate LiveKit connect + agent-dispatch latency; `docs/ARCHITECTURE.md` doesn't specify a Mode B–specific TTL, so this is a documented assumption).
  - `403 PLAN_NOT_ENTERPRISE` if the resolved org's plan isn't Enterprise.
  - `409 SESSION_ENDED` if the session already ended.
- **Mode A branch**: `throw notImplemented("mode_a_not_implemented")` — a documented seam for the future Phase 1 spec to fill in additively, not a silent fake.
- The whole route is gated behind `FEATURE_MODE_B_ENABLED` (default `false`); when disabled, returns `503 FEATURE_DISABLED`.

### Tenant isolation

`orgId` is never trusted from client input past this endpoint. It is embedded once, server-side, into `room.metadata` at room-creation time. `apps/agent` parses `orgId` out of `room.metadata` for every `withOrg(orgId, fn)` call it makes during that job — it never accepts an org id from the room name, a participant, or any other client-influenced source. `roomName` (`ls_<uuid>`) is itself opaque and carries no tenant information, and the learner's `AccessToken` is scoped to exactly one room, so guessing another tenant's room name still cannot be joined.

Per `.claude/rules/tenancy.md`, this diff requires a `security-reviewer` pass before merge (token minting).

---

## Database Changes

### Additive change to `Organization`

```prisma
enum OrganizationPlan {
  STARTER
  PRO
  ENTERPRISE
}
```
- `Organization.plan OrganizationPlan @default(STARTER)` — minimal enum only, set manually (ops / `prisma studio`) until Phase 7 builds a real plan lifecycle. Without this field, Phase 6's "mode resolution by plan" exit criterion has nothing to resolve against.

### New model: `LearnerSession`

Tenant-scoped (`org_id` + RLS, per `.claude/rules/tenancy.md`), deliberately distinct from `Session` (the login/cookie session) and `TrainingSession` (the dashboard/trainer rehearsal session from `video-chat-session.md`):

```prisma
enum TransportMode { MODE_A_DIRECT MODE_B_LIVEKIT }   // reuse if video-chat-session.md's migration already exists
enum LearnerSessionStatus { ACTIVE ENDED }
enum LearnerSessionEndReason { LEARNER_LEFT IDLE_TIMEOUT MAX_DURATION ERROR COST_GATE_TIMEOUT }

/// Tenant-scoped. org_id + RLS required — see .claude/rules/tenancy.md.
/// Learner-facing (widget) session. Distinct from `Session` (login) and
/// `TrainingSession` (dashboard/trainer rehearsal, see video-chat-session.md).
model LearnerSession {
  id                        String   @id @default(uuid()) @db.Uuid
  orgId                     String   @map("org_id") @db.Uuid
  applicationId             String   @map("application_id") @db.Uuid
  clientRequestId           String   @map("client_request_id")

  status                    LearnerSessionStatus     @default(ACTIVE)
  transportMode             TransportMode            @default(MODE_A_DIRECT) @map("transport_mode")
  endReason                 LearnerSessionEndReason? @map("end_reason")

  livekitRoomName           String?   @unique @map("livekit_room_name")
  agentDispatchedAt         DateTime? @map("agent_dispatched_at")
  humanJoinedAt              DateTime? @map("human_joined_at")            // cost gate satisfied
  agentSessionStartedAt     DateTime? @map("agent_session_started_at")   // must be null until humanJoinedAt is set
  avatarProviderDegradedAt  DateTime? @map("avatar_provider_degraded_at")

  startedAt                 DateTime  @default(now()) @map("started_at")
  endedAt                   DateTime? @map("ended_at")
  lastActivityAt             DateTime  @default(now()) @map("last_activity_at")
  billableMs                Int?      @map("billable_ms")                // Phase 7 reconciles this, doesn't consume it here

  createdAt                 DateTime  @default(now()) @map("created_at")
  updatedAt                 DateTime  @updatedAt @map("updated_at")

  organization               Organization @relation(fields: [orgId], references: [id])
  application                Application  @relation(fields: [applicationId], references: [id])

  @@unique([orgId, clientRequestId])
  @@index([orgId, applicationId, status])
  @@map("learner_sessions")
}
```

Deliberately excludes transcript/message persistence (Phase 3 — `record_progress` — territory) and list/search endpoints (not a dashboard-style feature).

### Migrations

1. Generated: `CREATE TABLE learner_sessions`, additive `plan` column on `organizations`, new enums.
2. Hand-written: RLS policy on `learner_sessions` (`ENABLE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation ... USING (org_id = current_setting('app.current_org_id')::uuid)`), mirroring the existing pattern in prior auth/tenancy migrations. Covered automatically by `scripts/verify-rls.mjs`'s generic check — no `EXEMPT_TABLES` entry needed.

---

## UI Changes

None. This spec does not touch `apps/widget`, `apps/dashboard`, or `packages/embed`. It exists purely to guarantee that the *contract* — the shape of `connect`'s response, and the `AvatarRenderer`/`StreamAvatarRenderer` interface — is symmetric across Mode A and Mode B, so that whichever future spec builds the widget's session UI (Phase 1/4 territory) can treat both transport modes identically, per Phase 6's exit criterion "identical widget UX across both modes."

---

## Realtime Changes

### `apps/agent` worker

Replaces the current stub (`apps/agent/src/worker.ts`, which just returns a literal string) with a real implementation of the lifecycle described in `docs/ARCHITECTURE.md` §4:

worker boots → registers with LiveKit → idle → job dispatch (room created by `POST /v1/sessions/:id/connect`) → join room → **wait for a non-agent participant (cost gate — do not skip)** → human present → start `AgentSession(RealtimeModel, tools)` → start `AvatarSession(provider)` → publish video track → ... → on last human leaves (with a grace period) OR idle timeout OR max duration → stop avatar, close model session, emit usage, leave room.

Module breakdown (new files, detailed under "Files to Create"):

- `worker.ts` — entry point, registers with LiveKit under `LIVEKIT_AGENT_NAME`, delegates each job.
- `job-handler.ts` — per-job orchestration: connect → cost gate → agent session + avatar session → teardown watchers.
- `cost-gate.ts` — `waitForHumanParticipant(...)`, the literal "wait for a non-agent participant" step. A participant counts as human iff `participant.kind !== ParticipantKind.AGENT` (LiveKit protocol enum). Checks already-present participants first (join race), then subscribes to future joins, rejecting on `AGENT_JOIN_TIMEOUT_MS` with `COST_GATE_TIMEOUT` and **no usage emitted**.
- `agent-session.ts` — constructs the OpenAI `RealtimeModel` server-side (key never reaches the browser) with an empty/no-op tool set (Phase 3's tool registry doesn't exist yet), starts `AgentSession`.
- `avatar-session.ts` — resolves an `AvatarProvider` (see below), starts `AvatarSession`, owns the "no video track after 5s → degrade" timer per `docs/ARCHITECTURE.md` §2's failure table.
- `teardown.ts` — the three exit conditions (last human leaves + `LAST_HUMAN_GRACE_MS` grace period to tolerate brief reconnects, `AGENT_IDLE_TIMEOUT_MS`, `AGENT_MAX_SESSION_MS`); stops avatar, closes model session, calls `emitUsage()`, leaves room.
- `config.ts` — Zod-validated env (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OPENAI_API_KEY`, `AGENT_JOIN_TIMEOUT_MS`, `AGENT_IDLE_TIMEOUT_MS`, `AGENT_MAX_SESSION_MS`, `LAST_HUMAN_GRACE_MS`).
- `metrics.ts` — `emitUsage({ learnerSessionId, orgId, billableMs })`, a structured log line; Phase 7 is the actual billing consumer.
- `learner-session-repo.ts` — wraps `withOrg(orgId, fn)` calls at each lifecycle transition, injected so `cost-gate`/`job-handler` tests can mock it.
- `room-types.ts` — minimal `RoomParticipantSource`/`ParticipantLike` interfaces, satisfiable by both the real LiveKit `Room` and a test fake — this is what makes the cost gate testable without a live LiveKit server (see "Testing").

Workers remain stateless between jobs — no tenant data is cached in worker memory across sessions.

### Avatar-provider adapter

**Client side** (`packages/avatar-core`, additive, stays free of any LiveKit dependency):

```ts
export type AvatarProviderKind = "mesh3d" | "stream";

export interface StreamAvatarRenderer extends AvatarRenderer {
  attachTrack(track: MediaStreamTrack): void;
  detachTrack(): void;
  readonly hasVideo: boolean;
}
```
`createStreamAvatarRenderer(): StreamAvatarRenderer`, new file `stream-avatar-renderer.ts`. Takes a raw Web-standard `MediaStreamTrack`, never a `livekit-client` type — unwrapping LiveKit's `RemoteVideoTrack` into a plain `MediaStreamTrack` is the transport layer's job (Phase 1/4 territory), keeping `avatar-core` dependency-light as it is today. `setExpression`/`setViseme` are documented no-ops on this renderer (the server drives visible expression), so callers holding a plain `AvatarRenderer` reference don't need to branch on provider kind.

The `stream → mesh3d` degrade *orchestration* itself is not implemented here — that needs a `mesh3d` implementation (Phase 2 dependency) to swap into. This spec only exposes what a future compositor needs (`hasVideo`, a failure signal).

**Server side** (`apps/agent/src/avatar-providers/`, new, drives the worker):

```ts
export interface AvatarProvider {
  readonly kind: "stream";
  readonly name: string; // vendor identifier — not chosen by this spec
  start(ctx: { room: Room; agentSession: AgentSessionHandle }): Promise<AvatarProviderHandle>;
}

export interface AvatarProviderHandle {
  readonly videoPublished: Promise<void>; // resolves once a track is live — drives the 5s degrade timer
  stop(): Promise<void>;
}
```
`null-provider.ts` — a test double that never publishes video, used to exercise the degrade path deterministically in tests and local dev without a real vendor.

**Mid-session degrade signal**: when an `AvatarProviderHandle` fails after publishing, `avatar-session.ts` publishes a LiveKit data message so a future widget can swap renderers:
```ts
// packages/shared/src/learner-session/schema.ts
export const LIVEKIT_CONTROL_DATA_TOPIC = "avatrain-control";
export const avatarDegradeMessageSchema = z.object({
  type: z.literal("avatar_degraded"),
  to: z.literal("mesh3d"),
  reason: z.enum(["no-video-track", "provider-error"]),
});
```
Consuming this message is out of scope — a future widget spec's job.

### Multi-region

`apps/api/src/lib/livekit.ts` selects the LiveKit deployment (`LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`) per `organization.dataRegion`, not a single global client — consistent with `docs/ARCHITECTURE.md` §6's "EU agent workers" requirement. Actual infra provisioning is out of scope; the code must not hardcode one deployment.

All work in this section falls under `.claude/rules/realtime.md`: event names only through `REALTIME_EVENTS` (never inline literals), the OpenAI data channel must be named `oai-events`, ephemeral secrets never logged/persisted/reused, barge-in handler order is fixed, nothing new added to the audio callback, and any diff here requires `pnpm bench:latency` output plus a `latency-auditor` pass before merge.

---

## Files to Modify

- `apps/agent/src/worker.ts`, `apps/agent/src/index.ts`, `apps/agent/package.json`
- `apps/api/src/app.ts`
- `packages/avatar-core/src/index.ts`
- `packages/shared/src/index.ts`
- `prisma/schema.prisma`
- `.env.example`

## Files to Create

- `apps/agent/src/job-handler.ts` (+ test)
- `apps/agent/src/cost-gate.ts` (+ test)
- `apps/agent/src/agent-session.ts` (+ test)
- `apps/agent/src/avatar-session.ts` (+ test)
- `apps/agent/src/teardown.ts` (+ test)
- `apps/agent/src/config.ts` (+ test)
- `apps/agent/src/metrics.ts` (+ test)
- `apps/agent/src/learner-session-repo.ts` (+ test)
- `apps/agent/src/room-types.ts`
- `apps/agent/src/avatar-providers/types.ts`
- `apps/agent/src/avatar-providers/null-provider.ts` (+ test)
- `apps/api/src/routes/sessions.ts` (+ test, including two-org isolation and plan-gating tests)
- `apps/api/src/services/learner-session-service.ts`
- `apps/api/src/lib/livekit.ts`
- `packages/avatar-core/src/stream-avatar-renderer.ts` (+ test)
- `packages/shared/src/learner-session/schema.ts` (+ test)
- `packages/shared/src/learner-session/index.ts`
- `packages/shared/src/livekit/constants.ts`
- Two Prisma migrations (generated `CREATE TABLE learner_sessions` + additive `plan` column; hand-written RLS)

---

## Dependencies

None of the following are installed anywhere in the repo today — all require explicit approval per CLAUDE.md before being added:

- `livekit-server-sdk` — `apps/api` (`AccessToken`, `RoomServiceClient`).
- `@livekit/agents` — `apps/agent` (worker registration, `JobContext`, `AgentSession`/`AvatarSession` primitives). Verify the current API surface against live LiveKit docs before implementation — `docs/ARCHITECTURE.md`'s class names are prose, not a version-pinned reference, per CLAUDE.md's "Verify external APIs before implementation."
- `@livekit/agents-plugin-openai` — `apps/agent` (`RealtimeModel` wrapping OpenAI Realtime server-side).
- `@livekit/rtc-node` — likely transitive via `@livekit/agents`; called out explicitly since it's the source of the real `Room`/participant objects `cost-gate.ts` depends on.

**Not added by this spec**: `livekit-client` / `@livekit/components-*` (widget-side room join is out of scope), any photoreal-vendor SDK (open business decision).

---

## Implementation Rules

- Follow every rule in `CLAUDE.md`.
- Never expose `OPENAI_API_KEY` — it lives only in `apps/agent`'s server-side process.
- Maintain tenant isolation using `org_id`; `orgId` reaches `apps/agent` only via server-set `room.metadata`, never a client-supplied value.
- Keep provider-specific logic inside adapters (`AvatarProvider` server-side, `StreamAvatarRenderer` client-side).
- Validate all new API request/response shapes with Zod.
- Preserve the public embed SDK contract — this spec does not touch `packages/shared/src/contracts` or `packages/embed`.
- Keep realtime latency low; do no expensive work inside the agent's audio/event handlers.
- Use strict TypeScript, no `any`.
- Prefer modifying existing code (`apps/agent`, `packages/avatar-core` already have the files this spec extends).
- Run `pnpm verify` before considering any implementation PR complete.
- The `/v1/sessions/*` routes must be gated behind `FEATURE_MODE_B_ENABLED` (default `false`) until Phase 4 lands.
- Run `security-reviewer` on the token-minting diff (`apps/api/src/lib/livekit.ts`, `routes/sessions.ts`) before merge, per `.claude/rules/tenancy.md`.
- Run `latency-auditor` on any diff touching `apps/agent` or `packages/avatar-core`, per `.claude/rules/realtime.md`.

---

## Testing

**Unit Tests**
- `cost-gate.ts`: no human ever joins → `waitForHumanParticipant` rejects at `AGENT_JOIN_TIMEOUT_MS`, and `startAgentSession`/`startAvatarSession`/`emitUsage` (all mocked) are never called. Agent-kind-only participants don't satisfy the gate. Human joins after the agent → resolves with that participant. Human already present at join time (race) → resolves immediately from pre-seeded participants, no event wait.
- `job-handler.ts`: mock-order assertion proving `waitForHumanParticipant` resolves strictly before `startAgentSession`/`startAvatarSession` are invoked — the literal mechanism for Phase 6's "provably does not start a paid session before a human joins" exit criterion.
- `avatar-session.ts`: no video track after 5s triggers the degrade signal exactly once; `null-provider.ts` never resolves `videoPublished`.
- `teardown.ts`: each of the three exit conditions (last-human-left-plus-grace, idle timeout, max duration) triggers exactly one `emitUsage()` call and one room-leave.

**Integration Tests**
- `apps/api/src/routes/sessions.test.ts`: `POST /v1/sessions` + `POST /v1/sessions/:id/connect` happy path for an Enterprise org; `403 PLAN_NOT_ENTERPRISE` for a non-Enterprise org; `409 SESSION_ENDED`; `503 FEATURE_DISABLED` when the flag is off; two-org isolation test asserting org B cannot read or connect to org A's `LearnerSession` (per `.claude/rules/tenancy.md`).

**End-to-End Tests**
- Out of scope for this spec (no widget UI exists yet to drive an E2E flow) — deferred to whichever future spec builds the widget-side consumer.

**Realtime Tests**
- Cost-gate and teardown tests run against the fake `RoomParticipantSource`/`ParticipantLike` from `room-types.ts`, no live LiveKit server required in CI, consistent with Phase 1's "CI runs realtime tests off recorded fixtures, no live API calls" convention.

**Latency Benchmarks**
- `pnpm bench:latency` output required in the PR for any diff touching `apps/agent` or `packages/avatar-core`, per `.claude/rules/realtime.md`.

**Manual Verification**
- Against a real dev/staging LiveKit deployment: join a room as only the agent, confirm via worker logs and the OpenAI usage dashboard that no Realtime connection opens for 60s+; then join as a human and confirm the agent session and avatar session start with bounded latency; kill the avatar provider mid-session and confirm the `avatar_degraded` data message is published without dropping the audio session.

---

## Definition of Done

- [ ] `apps/agent` worker implements the full lifecycle in `docs/ARCHITECTURE.md` §4, replacing the Phase 6 stub
- [ ] Cost-gate unit tests prove the agent/avatar session and usage emission never fire before a human participant is present
- [ ] `POST /v1/sessions` and `POST /v1/sessions/:id/connect` (Mode B branch) implemented, Zod-validated, `withOrg`-wrapped, two-org isolation tested
- [ ] `LearnerSession` and `Organization.plan` migrations applied with RLS verified by `scripts/verify-rls.mjs`
- [ ] `StreamAvatarRenderer` (client) and `AvatarProvider`/`null-provider` (server) adapters implemented and tested
- [ ] New LiveKit dependencies explicitly approved and added
- [ ] `FEATURE_MODE_B_ENABLED` flag defaults to `false`; routes return `503 FEATURE_DISABLED` when off
- [ ] `security-reviewer` run on token-minting diff; findings resolved
- [ ] `latency-auditor` run on `apps/agent`/`packages/avatar-core` diffs; findings resolved
- [ ] All tests pass
- [ ] `pnpm verify` passes
- [ ] No lint errors
- [ ] No TypeScript errors
- [ ] `pnpm bench:latency` output attached to the PR
- [ ] Documentation updated (`docs/ARCHITECTURE.md`/`docs/ROADMAP.md` status notes if this changes Phase 6's tracked state)
- [ ] No security regressions; tenant isolation confirmed end to end
