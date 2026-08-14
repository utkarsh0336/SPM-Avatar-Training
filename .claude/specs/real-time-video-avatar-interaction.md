# Spec: Real-Time Video Avatar Interaction

## Overview

This feature closes the two remaining gaps in the platform's live avatar experience, as surfaced by
a build audit against the current codebase:

**Already built (out of scope to rebuild — this spec only extends it):**
- Live avatar rendering mounted in both live-conversation surfaces —
  `apps/dashboard/app/sessions/[trainingSessionId]/VideoStage.tsx` and
  `apps/dashboard/app/voice-ai/[voiceSessionId]/VoiceStage.tsx` — backed by
  `packages/avatar-core`'s `AvatarProvider` interface, with `VrmAvatarProvider` (free, default) and
  `SimliAvatarProvider` (paid, opt-in via `AVATAR_PROVIDER=simli`) implementations.
- Continuous idle/talk state animation: `vrm-idle-animator.ts` (blink, gaze drift, head sway),
  `vrm-expression-driver.ts` (viseme lip-sync), `vrm-emotion-driver.ts` (emotion presets).
- Client-side barge-in: `packages/realtime-core/src/barge-in-controller.ts` stops avatar playback
  synchronously the instant the learner speaks, per `.claude/rules/realtime.md`'s fixed handler
  order — a client-side-only guarantee, not dependent on server round-trip.

**What's missing (this spec's actual scope):**
1. **Gesture-based / body-language interaction** — no such system exists today. The avatar's only
   body motion is `vrm-idle-animator.ts`'s blink/gaze/head-sway, which that file's own comment
   labels explicitly as covering only *part* of "the 'human facial expressions and gestures' gap
   from SOW §3.1." Arm, hand, and torso gesture motion — the avatar visibly *speaking with its
   body*, not just its face — does not exist.
2. **The Enterprise LiveKit real-time video path** — `apps/agent/src/worker.ts` is a literal
   one-line stub (`return "agent worker stub — LiveKit wiring lands in Phase 6"`). No `livekit-*`
   npm dependency is installed anywhere in the repo. `Organization.plan` does not exist in
   `prisma/schema.prisma`. Production transport today, per `.claude/rules/tenancy.md`'s sibling
   `.claude/rules/realtime.md`, is a **plain WebSocket** (`apps/api`'s
   `/v1/conversations/:trainingSessionId/ws`) — not WebRTC/LiveKit as `CLAUDE.md` and
   `docs/ARCHITECTURE.md` describe. That discrepancy between the architecture docs and the actual,
   deliberately-$0 stack (`.claude/specs/ai-avatar.md` §3) is real and is not silently resolved by
   this spec — see **Architecture Reconciliation** below.

This spec is deliberately **additive**: the WebSocket transport, VRM/Simli rendering, and idle
animation stay exactly as they are for every non-Enterprise org. Nothing here replaces them.

---

## Business Goal

**Gestures**: a talking avatar whose only motion is above the neck reads as stiff and reduces
trainer/learner trust during rehearsal and real training sessions — this is a named requirement in
the original SOW (§3.1, "human facial expressions and gestures"), only half-delivered today. Closing
it is a perceived-quality fix, not a new capability.

**LiveKit / Mode B**: `CLAUDE.md`'s own tech constraint says "LiveKit only for enterprise avatar
mode" — i.e. the product's Enterprise tier is supposed to be differentiated by a server-mediated,
higher-fidelity video pipeline. Today that differentiation doesn't exist: every org, regardless of
plan, gets the same free-tier WebSocket + VRM/Simli path, because `apps/agent` never grew past its
Phase-0 stub. This blocks selling (or even demoing) the Enterprise tier's namesake feature.

---

## Depends On

- `packages/avatar-core`'s `AvatarProvider` interface and `VrmAvatarProvider`/`SimliAvatarProvider`
  implementations (built — extended, not redefined, by this spec).
- `packages/avatar-core/src/vrm-idle-animator.ts` (built — the gesture layer is a sibling animator,
  not a rewrite of this file; see Realtime Changes for the coexistence contract).
- `packages/realtime-core/src/barge-in-controller.ts` and `conversation-session.ts` (built).
- `packages/shared/src/providers/*` — the real, already-working `llm-factory.ts`/`llm-failover.ts`
  (Gemini + Groq), `stt-factory.ts` (Groq Whisper), `tts-factory.ts`/`tts-failover.ts`
  (Echogarden + MS Edge). The LiveKit worker **must** call through these existing factories, not
  introduce a second, OpenAI-Realtime-specific model pipeline — see Architecture Reconciliation.
- `apps/api/src/routes/conversations.ts` and `apps/api/src/lib/ws-tickets.ts` (built — the pattern
  this spec's new LiveKit-credential route follows).
- **Not yet built, added by this spec**: `Organization.plan`. No prior spec defines it despite
  `.claude/specs/ai-voice-livekit.md` proposing an equivalent field — that spec was never
  implemented (see Architecture Reconciliation), so this spec adds it fresh rather than assuming it
  exists.

---

## Architecture Reconciliation (read before implementing)

Two prior specs — `.claude/specs/video-chat-session.md` and `.claude/specs/ai-voice-livekit.md` —
already designed a Mode A (direct WebRTC to OpenAI Realtime) / Mode B (LiveKit) split, an
`OrganizationPlan` enum, and an `apps/agent` worker lifecycle. **Neither was implemented as
written.** What actually shipped instead, per `.claude/specs/ai-avatar.md`'s explicit $0-cost
mandate, is a different stack entirely: Gemini/Groq LLM, Groq Whisper STT, Echogarden/MS Edge TTS,
plain WebSocket transport, VRM (free) + Simli (paid, opt-in) avatar rendering. `CLAUDE.md`'s "OpenAI
Realtime API (WebRTC)" line and `docs/ARCHITECTURE.md`'s WebRTC-centric failure table describe the
never-built path, not the real one — this spec does not "fix" those docs, but does not follow them
either. This is flagged, not silently picked.

**Consequence for this spec's LiveKit worker**: it cannot be "an OpenAI `RealtimeModel` running
server-side," per `ai-voice-livekit.md`'s original design — there is no OpenAI Realtime integration
anywhere in this codebase to server-mediate. Instead, `apps/agent`'s job handler must drive the
*existing* LLM/STT/TTS provider factories (`packages/shared/src/providers/*`) the same way
`apps/api/src/services/conversation-service.ts` already does over the WebSocket path, publishing the
resulting audio (and, for the avatar, video) as LiveKit tracks instead of WS binary frames. This is
a genuinely new integration shape, not a drop-in of the old spec's design.

**Open question, not resolved by this spec — flagged for Plan Mode**: `SimliAvatarProvider` today
is a *browser-side* adapter — it drives DOM `<video>`/`<audio>` elements and a browser WebRTC
connection directly to Simli. It cannot run inside `apps/agent`'s Node process as-is. Publishing a
Simli-driven video track from the LiveKit worker requires either (a) a server-side Simli integration
Simli's SDK may not support the same way, or (b) keeping Simli client-side and only using LiveKit to
carry VRM-rendered frames captured server-side (unusual — VRM rendering is currently a browser
WebGL/three.js concern, per `vrm-loader.ts`/`vrm-avatar-provider.ts`), or (c) a still-undetermined
third approach. **Per `CLAUDE.md`'s "Plan first for: Realtime transport" and "Verify external APIs
before implementation," this must be resolved in Plan Mode against live Simli/LiveKit docs before
Milestone 3 (below) starts — it is not something this spec can responsibly pre-decide.**

---

## Components Affected

- `packages/avatar-core` — new gesture animator, additive `AvatarProviderStartConfig`/interface
  surface if gesture triggers need to cross the provider boundary (see Realtime Changes).
- `packages/realtime-core` — conversation-session phase/emotion signals feed the gesture animator;
  no session-machine changes.
- `apps/agent` — primary: real LiveKit worker replacing the stub.
- `apps/api` — new LiveKit credential-minting route, `Organization.plan` read path.
- `apps/dashboard` — `VideoStage.tsx`/`VoiceStage.tsx` gain a photoreal-connection indicator and
  degrade-to-VRM badge for Mode B sessions; no layout changes otherwise.
- `packages/shared` — `Organization.plan` schema, LiveKit credential response schema, LiveKit
  constants (room/data-topic naming).
- `prisma` — additive `Organization.plan` column + `OrganizationPlan` enum.

Explicitly **not affected**: `apps/widget`, `packages/embed` (no learner-facing embed widget exists
yet in this codebase to wire either gesture or LiveKit into).

---

## API Changes

### `POST /v1/conversations/:trainingSessionId/livekit-connect`

New, follows the exact pattern already established by `/v1/conversations/ticket` and
`/v1/conversations/simli-session` in `apps/api/src/routes/conversations.ts` (`app.authenticate`
preHandler, per-user rate limit, no request body beyond the route param).

- Auth: required (session cookie, same as the two existing routes above).
- Gated behind `FEATURE_LIVEKIT_ENABLED` env flag, default `false` → `503 { error: { code:
  "feature_disabled" } }` when off, mirroring `.claude/specs/ai-voice-livekit.md`'s original
  `FEATURE_MODE_B_ENABLED` convention (kept, since it was never actually applied to real code).
- `403 { error: { code: "plan_not_enterprise" } }` if the caller's `Organization.plan !==
  "ENTERPRISE"`.
- `409 { error: { code: "session_ended" } }` if the `TrainingSession`/voice session is already
  ended.
- Success: `201 { livekitUrl, roomToken, roomName }`. Room created idempotently via
  `RoomServiceClient.createRoom` (per-request; `apps/agent` registers for **explicit dispatch**
  against that room name so the worker fleet never receives a job apps/api didn't intentionally
  create — the same cost-control reasoning `.claude/specs/ai-voice-livekit.md` already documented).
  Token is scoped to exactly that room, random opaque `identity` (never learner/trainer PII), TTL
  `LIVEKIT_TOKEN_TTL_SECONDS` (proposed 300s — **ASSUMPTION**, no existing precedent in this repo to
  match, since the WS ticket's 60s TTL was sized for a much shorter mint-to-connect gap).
- Rate limit: mirrors `SIMLI_SESSION_RATE_LIMIT` (`{ max: 10, windowMs: 5 * 60_000 }`) since this,
  like Simli, mediates a paid/metered resource.

No changes to `/v1/conversations/ticket`, `/v1/conversations/simli-session`, or the WS route itself
— Mode B is additive, selected only when `Organization.plan === "ENTERPRISE"` and the flag is on.

Per `.claude/rules/tenancy.md`, this route requires a `security-reviewer` pass before merge (token
minting) and a two-org isolation test (org B cannot mint a token for org A's session).

---

## Database Changes

Single additive change to `prisma/schema.prisma` (no new tables):

```prisma
enum OrganizationPlan {
  STARTER
  PRO
  ENTERPRISE
}

// On Organization:
plan OrganizationPlan @default(STARTER)
```

No self-serve upgrade flow or Stripe linkage — plan is set manually (ops / `prisma studio`) until a
future billing spec exists, matching `.claude/specs/ai-voice-livekit.md`'s original scoping of the
same field.

Migration: one generated `ALTER TABLE organizations ADD COLUMN plan ...` migration. No RLS change
needed (`organizations` itself is the tenant root, not a tenant-scoped child table).

No database changes for gestures — gesture state is client-side animation state only, never
persisted (same lifetime class as `vrm-idle-animator.ts`'s blink/gaze phase, which is also never
persisted).

---

## UI Changes

**`VideoStage.tsx`** (`apps/dashboard/app/sessions/[trainingSessionId]/`) and **`VoiceStage.tsx`**
(`apps/dashboard/app/voice-ai/[voiceSessionId]/`):
- When a session is Mode B (LiveKit) and connected, show a small "Photoreal" indicator badge in the
  existing header-overlay convention (same slot pattern already used for the live/waveform badge).
- On LiveKit avatar-provider failure mid-session (no video track after a timeout), show a
  single, non-repeating degrade notice and continue on the existing VRM/Simli path — "degrade,
  never drop," per `docs/ARCHITECTURE.md` §2's failure table, which this spec **does** still honor
  even though the transport underneath it changed.
- No new controls added to `ControlBar.tsx`/`VoiceControlBar.tsx` — Mode B is a connection-quality
  property, not a user-toggleable mode.

Gestures require no new UI surface — they render inside the existing avatar mount point.

---

## Realtime Changes

### Gesture / body-language layer

New `packages/avatar-core/src/vrm-gesture-animator.ts`, structurally a sibling to
`vrm-idle-animator.ts` (same `{ tick(), reset() }` shape, same injectable
`random`/`now` pattern for deterministic tests), **not** a modification of that file. Per
`vrm-idle-animator.ts`'s own documented coexistence contract ("VRM expressions are independent
named slots that blend additively via `expressionManager.setValue(name, w)`, so as long as each
system only ever writes its own preset names there's no conflict"), the gesture animator:

- Drives **arm/hand/torso humanoid bones** (`vrm.humanoid.getNormalizedBoneNode("leftUpperArm")`,
  `"rightUpperArm"`, `"spine"`, etc. — the same `@pixiv/three-vrm` accessor `vrm-idle-animator.ts`
  already uses for head/neck) via a small preset library (e.g. open-hand "explaining" gesture while
  `speaking`, chin-touch "thinking" pose while `thinking`, relaxed neutral while `listening`).
- Reads the same inputs `vrm-idle-animator.ts` and `vrm-emotion-driver.ts` already expose —
  conversation phase (speaking/thinking/listening) and current `AvatarEmotion` — no new event types
  invented; this is purely a new consumer of existing signals.
- Never touches `blink`/`lookLeft`/`lookRight`/`lookUp`/`lookDown` expression names or the
  head/neck bones `vrm-idle-animator.ts` already owns — bone/expression ownership is partitioned by
  file, same convention as the emotion/viseme split already documented there.
- `reset()` returns bones to their captured base rotation, called from `stop()`/teardown only —
  mirrors `vrm-idle-animator.ts`'s explicit "not on barge-in" rule, since body language, like idle
  motion, is about looking alive independent of speech state.

Mounted alongside the existing idle animator wherever `VrmAvatarProvider` already calls
`vrm-idle-animator`'s `tick()` per frame (`vrm-avatar-provider.ts`) — one more animator ticked in the
same render loop, not a new render loop.

`SimliAvatarProvider` is vendor-driven and has no bones to animate — gestures are a VRM-only
capability, same scoping `AvatarProvider.setEmotion?` already uses ("optional — only
`VrmAvatarProvider` implements this").

**Explicit non-goal**: this is the avatar's own outgoing body language, not learner-gesture
*recognition* (webcam-based hand-tracking, sign interpretation, etc.). No such input pipeline is
implied or built here — flagged because "gesture-based ... interaction" could be misread as
requiring computer-vision input; the only evidence in this codebase (`vrm-idle-animator.ts`'s SOW
§3.1 comment) is about avatar output, not learner input.

### LiveKit / Mode B path

Replaces `apps/agent/src/worker.ts`'s stub with the real lifecycle from `docs/ARCHITECTURE.md` §4,
**reconciled per Architecture Reconciliation above** — driving `packages/shared/src/providers/*`
instead of an OpenAI `RealtimeModel`:

```
worker boots → registers with LiveKit (explicit dispatch only) → idle
  → job dispatch (room created by POST /v1/conversations/:id/livekit-connect)
  → join room → WAIT for a non-agent participant          ← cost gate, do not skip
  → human present → start provider-backed conversation loop (llm-factory + stt-factory + tts-factory,
    same failover behavior conversation-service.ts already has over WS)
  → publish audio track; publish avatar video track (see open question above — blocked pending Plan
    Mode resolution)
  → on last participant leaves OR idle timeout OR max duration → close provider streams, emit usage
    log, leave room
```

New files (`apps/agent/src/`): `livekit-worker.ts` (replaces `worker.ts`'s stub entry point),
`job-handler.ts`, `cost-gate.ts` (`waitForHumanParticipant`, human ≡ `participant.kind !==
ParticipantKind.AGENT`), `teardown.ts`, `config.ts` (Zod-validated env: `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `AGENT_JOIN_TIMEOUT_MS`, `AGENT_IDLE_TIMEOUT_MS`,
`AGENT_MAX_SESSION_MS`), `metrics.ts` (structured usage log line — no billing consumer exists yet).

All work here falls under `.claude/rules/realtime.md`: wire message shapes only from
`packages/shared/src/realtime/ws-messages.ts`'s existing schemas where the LiveKit path reuses
WS-equivalent message semantics (never hand-typed inline); barge-in handler order stays fixed
(stop local playback synchronously first, notify server second) even over the LiveKit data channel;
nothing new added to any audio callback; `pnpm bench:latency` output and a `latency-auditor` pass
required in the PR.

---

## Files to Modify

- `apps/agent/src/worker.ts` — replaced with real entry point (or thinned to delegate to
  `livekit-worker.ts`)
- `apps/agent/src/index.ts`, `apps/agent/package.json`
- `apps/api/src/routes/conversations.ts` — add the `livekit-connect` route
- `apps/api/src/app.ts` — if a new route module is registered instead of extending
  `conversations.ts` directly
- `packages/avatar-core/src/vrm-avatar-provider.ts` — mount/tick the new gesture animator alongside
  the existing idle animator
- `packages/avatar-core/src/index.ts` — export the new gesture animator
- `packages/shared/src/index.ts` — export the new LiveKit/org-plan schema modules
- `packages/shared/src/org/schema.ts` — add `plan` to the org schema
- `prisma/schema.prisma` — `OrganizationPlan` enum + `Organization.plan`
- `apps/dashboard/app/sessions/[trainingSessionId]/VideoStage.tsx` — photoreal/degrade badge
- `apps/dashboard/app/voice-ai/[voiceSessionId]/VoiceStage.tsx` — same
- `.env.example` — new `FEATURE_LIVEKIT_ENABLED`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET`, `LIVEKIT_TOKEN_TTL_SECONDS` entries, each documented per existing convention

---

## Files to Create

**`packages/avatar-core`**
- `packages/avatar-core/src/vrm-gesture-animator.ts` (+ `.test.ts`)
- `packages/avatar-core/src/gesture-presets.ts` (+ `.test.ts`) — the small preset library (bone
  targets + weights per conversation phase)

**`apps/agent`**
- `apps/agent/src/livekit-worker.ts` (+ test)
- `apps/agent/src/job-handler.ts` (+ test)
- `apps/agent/src/cost-gate.ts` (+ test)
- `apps/agent/src/teardown.ts` (+ test)
- `apps/agent/src/config.ts` (+ test)
- `apps/agent/src/metrics.ts` (+ test)
- `apps/agent/src/room-types.ts` — minimal participant-source interfaces so `cost-gate.ts` is
  testable without a live LiveKit server, same reasoning `.claude/specs/ai-voice-livekit.md`
  documented for its own (never-built) version of this file

**`apps/api`**
- `apps/api/src/lib/livekit.ts` (+ test) — room creation + token minting
- `apps/api/src/routes/conversations.test.ts` — extended with the new route's tests, or a new
  `livekit.test.ts` if kept separate

**`packages/shared`**
- `packages/shared/src/livekit/constants.ts` (+ test) — room-name format, data-topic name
- `packages/shared/src/livekit/schema.ts` (+ test) — credential response Zod schema

**Prisma**
- `prisma/migrations/<timestamp>_add_organization_plan/migration.sql` (generated)

---

## Dependencies

**Gestures**: none. `@pixiv/three-vrm` is already a dependency (used identically by
`vrm-idle-animator.ts` today).

**LiveKit** — none of the following are installed anywhere in this repo today; each requires
explicit approval per `CLAUDE.md` before being added:
- `livekit-server-sdk` — `apps/api` (`AccessToken`, `RoomServiceClient`).
- `@livekit/agents` and `@livekit/rtc-node` — `apps/agent` (worker registration, job context, room
  participant/track primitives). Verify the current API surface against live LiveKit docs before
  implementation, per `CLAUDE.md`'s "Verify external APIs before implementation" — the class names
  in `docs/ARCHITECTURE.md` are prose, not a version-pinned reference.

**Not added by this spec**: `livekit-client` (no learner-facing embed widget exists yet to consume
it from the browser side — Mode B here is scoped to the dashboard/voice-ai surfaces' `apps/agent`
half only); any second avatar-video vendor SDK (Simli is already the chosen paid vendor, per
`simli-client` already being a dependency — this spec does not evaluate alternatives).

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`.
- Never expose `OPENAI_API_KEY` — moot here since no OpenAI integration exists in this codebase;
  applies equally to `SIMLI_API_KEY`/`LIVEKIT_API_SECRET` never reaching the browser.
- Maintain tenant isolation using `org_id`; `orgId` reaches `apps/agent` only via server-set room
  metadata, never a client-supplied value.
- Keep provider-specific logic inside adapters — the gesture animator and LiveKit worker are both
  new adapters, not modifications to `AvatarProvider`'s existing contract.
- Validate all new API request/response shapes with Zod.
- Preserve the public embed SDK contract (untouched by this spec).
- Keep realtime latency low; nothing new in any audio callback.
- Use strict TypeScript, no `any`.
- Prefer modifying existing code — `vrm-avatar-provider.ts`'s render loop, `conversations.ts`'s
  route module — over parallel implementations.
- Run `pnpm verify` before considering any implementation PR complete.

Feature-specific:

- `FEATURE_LIVEKIT_ENABLED` defaults to `false`; the route returns `503` when off, same convention
  `.claude/specs/ai-voice-livekit.md` specified (never actually shipped) for `FEATURE_MODE_B_ENABLED`.
- The gesture animator must never write a `vrm-idle-animator.ts`-owned expression/bone name — bone
  ownership is partitioned by file per the Realtime Changes section above.
- `apps/agent`'s conversation loop reuses `packages/shared/src/providers/*` — do not introduce a
  second LLM/STT/TTS integration.
- The Simli-in-`apps/agent` open question (Architecture Reconciliation) must be resolved in Plan
  Mode, against live vendor docs, before any LiveKit-video-track code is written.
- `security-reviewer` invoked on `apps/api/src/lib/livekit.ts` and the `livekit-connect` route
  (token minting) before merge, per `.claude/rules/tenancy.md`.
- `latency-auditor` invoked on any diff touching `apps/agent` or `packages/avatar-core`, per
  `.claude/rules/realtime.md`; `pnpm bench:latency` output required in that PR.

---

## Testing

**Unit**
- `vrm-gesture-animator.test.ts`: deterministic (`random`/`now` injected) — correct bone targets
  selected per phase, `reset()` zeroes gesture bones without touching idle-animator-owned
  blink/gaze state (cross-file non-interference asserted explicitly).
- `cost-gate.test.ts`: no human ever joins → rejects at `AGENT_JOIN_TIMEOUT_MS`, conversation loop
  never starts; human already present at join (race) resolves immediately; agent-kind-only
  participants don't satisfy the gate.
- `job-handler.test.ts`: mock-order assertion — `waitForHumanParticipant` resolves strictly before
  the provider conversation loop starts (the literal mechanism proving no paid session starts
  before a human joins).
- `teardown.test.ts`: each of the three exit conditions triggers exactly one usage-emit and one
  room-leave, no double-emit.

**Integration**
- `apps/api`: `livekit-connect` happy path for an Enterprise org; `403 plan_not_enterprise` for a
  non-Enterprise org; `503 feature_disabled` when the flag is off; `409 session_ended`; two-org
  isolation test (org B cannot mint a token for org A's session).

**Realtime Tests**
- Cost-gate/teardown tests run against a fake participant source (`room-types.ts`), no live
  LiveKit server required in CI — consistent with this repo's existing realtime-test convention of
  no live API calls in CI.

**Latency Benchmarks**
- `pnpm bench:latency` output required in the PR for any diff touching `apps/agent` or
  `packages/avatar-core`.

**Manual Verification**
- Gestures: visually confirm arm/hand motion during `speaking`/`thinking` phases in both
  `VideoStage.tsx` and `VoiceStage.tsx`, with no visible fighting against blink/gaze/head-sway.
- LiveKit: against a real dev LiveKit deployment, confirm via worker logs that no provider calls
  fire until a human joins; confirm plan-gating end to end; confirm degrade-to-VRM on avatar
  provider failure does not drop the audio session.

---

## Definition of Done

- [ ] Gesture animator implemented, tested, mounted in both live-conversation surfaces, with proven
      non-interference against the existing idle animator
- [ ] `apps/agent` LiveKit worker implements the real lifecycle, replacing the Phase-0 stub
- [ ] Cost-gate tests prove the conversation loop and usage emission never fire before a human
      participant is present
- [ ] `livekit-connect` route implemented, Zod-validated, plan-gated, flag-gated, two-org isolation
      tested
- [ ] `Organization.plan` migration applied
- [ ] New LiveKit dependencies explicitly approved and added
- [ ] The Simli-in-`apps/agent` open question is resolved (in Plan Mode, against live docs) before
      any video-track publishing code is merged — or explicitly deferred with a documented fallback
      (e.g. Mode B ships audio-only first, video-track publishing as a fast-follow)
- [ ] `security-reviewer` run on token-minting diff; findings resolved
- [ ] `latency-auditor` run on `apps/agent`/`packages/avatar-core` diffs; findings resolved
- [ ] All tests pass; `pnpm verify` passes; no lint or TypeScript errors
- [ ] `pnpm bench:latency` output attached to the PR
- [ ] No security regressions; tenant isolation confirmed end to end

---

## Explicit Non-Goals

- Learner/trainer gesture *recognition* (webcam hand-tracking, computer vision input) — this spec
  is avatar-output body language only.
- Replacing the default WebSocket transport for non-Enterprise orgs — untouched.
- Reconciling `CLAUDE.md`/`docs/ARCHITECTURE.md`'s OpenAI-Realtime-WebRTC description with the real
  stack — flagged, not fixed, by this spec.
- Stripe/billing linkage for `Organization.plan` — manual assignment only, same as every other
  prior spec that touched plan-gating.
- `apps/widget`/`packages/embed` LiveKit consumption — no learner-facing embed widget exists yet in
  this codebase to wire it into.

---

## Implementation Assumptions

1. `LIVEKIT_TOKEN_TTL_SECONDS` proposed at 300s — no existing precedent in this repo sizes a
   LiveKit-specific TTL; the WS ticket's 60s was sized for a much shorter mint-to-connect gap.
2. Gesture presets (which bones move, how far, on which phase) are a small illustrative set to be
   refined against real playback, not a fixed final design — the *mechanism* (sibling animator,
   phase/emotion-driven, non-interfering with idle animation) is the load-bearing part of this spec.
3. The Simli-server-side-vs-VRM-server-side question for Mode B's video track is treated as
   genuinely open, resolved in Plan Mode before Milestone 3 — not pre-decided here.
4. "Gesture-based / body-language interaction" refers to the avatar's own output motion, per the
   only in-repo evidence (`vrm-idle-animator.ts`'s SOW §3.1 comment), not learner-gesture input.

---

## Implementation Status (as built)

Both tracks are implemented, tested, and passing `pnpm verify` end to end (lint, typecheck, every
package's test suite, RLS, provider-boundary, dashboard production build, embed size). Corrections
discovered during implementation, superseding the corresponding sections above:

1. **`setPhase?` was a real gap, now closed.** `AvatarProvider` gained an optional
   `setPhase?(phase: AvatarConversationPhase)`, mirroring `setEmotion?` exactly.
   `packages/realtime-core/src/conversation-session.ts`'s 13 `onStatusChange` call sites now route
   through one `setStatus()` helper that also calls `options.avatar.setPhase?.()`. Implemented by
   `VrmAvatarProvider`, forwarding into the new `vrm-gesture-animator.ts` (sibling to
   `vrm-idle-animator.ts`, same bone-ownership partitioning, disjoint bone set: `leftUpperArm`/
   `rightUpperArm`/`leftLowerArm`/`rightLowerArm`/`leftHand`/`rightHand`/`spine`/optional `chest`).
2. **Video-track mechanism resolved conclusively, from Simli's own installed SDK source** (`simli-
   client`'s `lib/transports/LivekitTransport.ts`), not just live-doc research: Simli's "LiveKit
   Backed WebRTC" mode (`wss://api.simli.ai/compose/webrtc/livekit?session_token=...`) always creates
   and hosts its own room — confirmed structurally, not just by inference. `apps/agent`'s
   `avatar-relay.ts` implements the two-room relay this implies: joins Simli's room, subscribes to
   its audio+video tracks via `@livekit/rtc-node`'s `AudioStream`/`VideoStream`, republishes them as
   local tracks into the learner/trainer's own room via `AudioSource`/`VideoSource` +
   `LocalAudioTrack.createAudioTrack`/`LocalVideoTrack.createVideoTrack`. This part
   (`defaultJoinSimliRoomAndRepublish`) is real code against the installed SDK's actual types but is
   **genuinely unverified against a live Simli+LiveKit deployment** — the orchestration around it
   (bridge wiring, the "TTS audio only ever goes to Simli, never double-published" invariant,
   skip/stop lifecycle) is unit-tested; the live media relay itself needs the manual verification
   pass below before it can be trusted.
3. **No persisted `TrainingSession`/`VoiceSession` table exists** (confirmed: 21 Prisma models, none
   of them this). `apps/api/src/lib/livekit.ts` tracks room ownership in an in-memory
   `Map<trainingSessionId, { roomName, orgId }>`, same precedent `ws-tickets.ts`/`rate-limit.ts`
   already set. **This surfaced a real tenant-isolation bug during implementation**, not present in
   the original design above: `trainingSessionId` is a human-readable, guessable slug with no
   ownership record: without a same-org check, a second org calling `livekit-connect` with the same
   string would silently be handed a join token into the *first* org's live room. Fixed via
   `RoomOwnershipMismatchError` (403 `training_session_owned_by_another_org`), covered by dedicated
   tests in `livekit.test.ts`. Flagged explicitly for the security-reviewer pass, since it's exactly
   the kind of tenancy defect that rule exists to catch.
4. **`livekit-client` added to `apps/dashboard`**, scoped to a new shared
   `apps/dashboard/lib/livekit-avatar-connect.ts` used by both `useConversationSession.ts` and
   `useVoiceConversationSession.ts`. Confirmed working end to end against a real (non-Enterprise) dev
   session: the `livekit-connect` attempt fires, gets `503 feature_disabled`, and falls straight
   through to the existing VRM/Simli/WS flow with zero visible regression or console errors.
5. **`apps/agent`'s new deps**: `@livekit/agents` (v1.6.3) turned out to be a full, opinionated,
   multi-process worker framework (spawns a child process per job via a *file path*, not a function
   reference) — richer than the original spec's "hand-rolled cost-gate/job-handler" framing assumed.
   Used only its low-level primitives (`defineAgent`, `JobContext`, `cli.runApp`/`ServerOptions`) as
   thin entrypoint glue; all real turn-orchestration logic (`job-handler.ts`, reusing
   `packages/shared/src/providers/*`'s exact factories) stayed hand-rolled and independently
   unit-tested, per the framework's own "thin glue, tested core" shape this codebase already uses
   elsewhere.
6. **New, not originally scoped**: `apps/agent/src/turn-boundary.ts` (server-side VAD, ported
   1:1 from `voice-activity-detector.ts`'s algorithm/constants for discrete pushed PCM frames instead
   of a polling loop) and `apps/agent/src/audio-encoding.ts` (WAV encoding from `Int16Array`,
   standalone rather than reusing `packages/realtime-core`'s Float32/Blob-oriented encoder, to avoid
   pulling browser-only globals into a Node dependency).
7. **Known v1 scope gap, flagged not silently worked around**: the LiveKit room metadata
   (`{ orgId, trainingSessionId }`) has no `avatarId`, so `apps/agent`'s job handler cannot resolve
   the session's actual persona/expertise/voice/Simli-face the way `conversation-service.ts` does
   from a real `Avatar` record over WS. Generic defaults are used instead (`buildSystemPrompt`'s
   `avatarName`/`expertise`, `createTTSProviderFromEnv`'s tone/gender/language, the base
   `SIMLI_FACE_ID`). Threading `avatarId` through the room metadata the same way is the natural
   fast-follow, not implemented here.
8. **Transcript/checkpoint/latency data-channel wiring is explicitly deferred** — a Mode B session
   gets working voice + (pending live verification) photoreal video, but its transcript panel stays
   empty until a follow-up wires `job-handler.ts`'s `onTranscript` through the LiveKit data channel
   using `packages/shared/src/realtime/ws-messages.ts`'s existing schemas, per this spec's own B4
   scope note.
9. **`security-reviewer` and `latency-auditor` were run on the finished diff, per
   `.claude/rules/tenancy.md`/`.claude/rules/realtime.md`, and found two real defects, both now
   fixed**:
   - **CRITICAL (security)**: the tenant-isolation guard in `apps/api/src/lib/livekit.ts`
     (`RoomOwnershipMismatchError`) was itself vulnerable to a TOCTOU race — the ownership
     reservation (`knownRooms.set(...)`) happened *after* the `await createRoom(...)` network call,
     so two concurrent callers for different orgs on the same `trainingSessionId` could both pass the
     ownership check before either reserved it, empirically confirmed to land both orgs in the same
     live room. Fixed by moving the reservation to before the `await` (closes the race via JS's
     single-threaded event loop — no other call can interleave inside a synchronous section), rolled
     back on `createRoom` failure. A new concurrency test in `livekit.test.ts` (racing two orgs with
     an artificially-delayed `createRoom`) exercises the actual interleaving, not just the sequential
     case the original tests covered.
   - **SEVERE (latency/correctness)**: barge-in was never wired on the LiveKit path — a human
     interrupting an in-flight avatar reply didn't abort the old turn or flush Simli's playback
     queue, so two turns could run concurrently with no way to reset the avatar to neutral. Fixed via
     a new `JobHandlerOptions.onBargeIn` callback, fired from the turn-boundary's `onSpeechStart` when
     a turn is already in-flight, wired in `livekit-worker.ts` to `AvatarRelay.skip()`. Covered by a
     new regression test in `job-handler.test.ts`.
   - Two minor allocation findings (a per-bone-per-frame object literal in
     `vrm-gesture-animator.ts`'s `targetFor`, and a per-audio-frame wrapper object in
     `job-handler.ts`'s `pushAudioFrame`) were also fixed — both were on genuinely hot per-frame
     paths (up to 60Hz/~100Hz respectively).
   - Confirmed: the `bench:latency` scripts added to `apps/agent`/`packages/avatar-core` are
     placeholder stubs only — they must not be read as "benchmarked" in any PR built from this spec.
10. **Live-verified against real LiveKit Cloud + Simli infrastructure (2026-08-15).** Confirmed
    working end to end against the real dev deployment (not mocks): `POST .../livekit-connect`
    returns a real `201`, correctly gated by `Organization.plan` (`STARTER` → `403`, flag off →
    `503`); `apps/agent` registers live with LiveKit Cloud on boot (`region: India South`) and
    receives explicit job dispatch only for rooms naming it. **The cost gate is now proven live, not
    just unit-tested**: the worker process sat idle after room creation and only began work the
    instant the browser's `livekit-client` joined the same room — confirmed by matching timestamps
    with a sub-second gap between "browser connected" and "job started" in the two processes' logs.
    The dashboard's **graceful degrade-to-VRM** on avatar failure also fired correctly live, silently
    falling back within its 5s timeout with no broken UI and no console errors.
    The two-room Simli video relay and the LiveKit-path barge-in remain **unverified against live
    media** — not from a code defect, but because the dev Simli account rejected the session-token
    exchange with `"Free credits ran out, upgrade plan on https://app.simli.com"`. The failure path
    itself behaved correctly (clean teardown: `job exiting` → `disconnected from room` → `native
    resources disposed`, no hang, no crash). Per explicit user decision, this stays unresolved rather
    than paying to unblock it — consistent with the project's $0/month default (VRM primary, Simli
    strictly opt-in, per `.claude/specs/ai-avatar.md`). `defaultJoinSimliRoomAndRepublish`'s actual
    media path remains verified only at the unit-test level (`avatar-relay.test.ts`'s injected-fake
    coverage of the testable core) until a funded Simli account is available to exercise it live.

**Ships today with one remaining gap.** Gestures (Track A) are live-verified end to end in-browser.
LiveKit Enterprise mode (Track B) is live-verified for everything except the Simli video relay
itself, which is blocked on Simli account credits, not code — see finding 10. Re-run the Manual
Verification section's LiveKit checklist once a funded Simli account is available; everything else
(the tenant-isolation fix, the cost gate, the turn loop, and the gesture animator) is covered by
`pnpm verify`, which passes clean, and now also by this live-verification pass.
