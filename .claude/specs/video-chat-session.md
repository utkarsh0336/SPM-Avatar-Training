# Spec: Video Chat Session

## Overview

A trainer-facing screen in `apps/dashboard` where a trainer starts or resumes a live voice+video
training session with an AI avatar they previously created via onboarding. This is the "New Chat"
surface referenced by the existing (currently stub, `href="/"`) sidebar nav item in
`apps/dashboard/app/onboarding/Sidebar.tsx`, generalized into the dashboard's permanent shell. It
is **not** the customer-embedded `apps/widget` — no publishable key, no learner identity JWT, no
`packages/embed` involvement. The trainer *is* the human on the call, testing/rehearsing with their
own avatar (session titles in the reference screenshot — "Sales Pitch Practice", "Compliance
Training", "Support Escalation Roleplay" — read as practice/demo sessions, not customer end-user
sessions).

The core persisted entity is **`TrainingSession`** (table `training_sessions`), deliberately not
named `Session` — that name is already claimed by the authentication spec's login-session table.
Every reference to "session" in this document that means *this feature's* entity says
`TrainingSession` explicitly; where it means the underlying OpenAI Realtime / LiveKit transport
session (the `packages/realtime-core/src/session-machine.ts` state machine, ephemeral and
reconnect-per-attempt), it says "realtime session" or "transport session."

**Sequencing note** (mirrors onboarding's own precedent): `docs/ROADMAP.md` places the dashboard
trainer surface in Phase 5, which formally depends on Phases 1–4. This spec's `Implementation Plan`
below is ordered so Milestones 1–2 need none of that (static UI + CRUD only); Milestone 3 needs
Phase-1-equivalent voice; Milestone 4 needs Phase-2-equivalent avatar rendering; Milestone 7 needs
Phase-6-equivalent LiveKit and is explicitly deferred/Enterprise-gated. Nothing here blocks on
Phases 1/2/6 being independently "done" elsewhere — this spec *is* where a real implementation of
those phases would first get consumed by a UI, if no other spec beats it there (flagged under
`Depends On`).

---

## Business Goal

Trainers need to actually *experience* the avatar they configured in onboarding before they trust
it enough to embed it for real customers/learners. Today `Avatar.status` flips to `ACTIVE` at the
end of onboarding and then the record is inert — there is no surface anywhere in the product that
lets a trainer talk to it. This feature is that surface, and it doubles as the first real,
non-fixture consumer of `packages/realtime-core` and `packages/avatar-core`, both of which are
currently empty interfaces/const-shells. It also produces the durable `training_sessions`/`messages`
data that Phase 5's "transcript search" roadmap exit criterion will eventually index.

---

## Depends On

- **Authentication** (`feature/authentication`, merged to `main` as a *spec and partial UI* —
  `apps/dashboard/app/login/**` exists, but its `User`/`Membership`/`Session` Prisma models and
  `apps/api` auth routes/middleware do not exist in `prisma/schema.prisma` or `apps/api` yet). This
  spec's route guard, `createdByUserId` foreign key, and org/plan resolution all need that to be
  real, not just documented.
- **Onboarding** (`feature/onboarding`, merged to `main` as a *spec and full wizard UI* — the wizard
  is fully built under `apps/dashboard/app/onboarding/**`, but `Avatar` is not yet in
  `prisma/schema.prisma`). This spec's `avatarId` foreign key, `Avatar.status = ACTIVE` gate, and
  the avatar name/expertise labels shown in the video header/side-panel all need that model to
  exist. **Do not redefine `Avatar` here** — extend it additively (see Database Changes).
- Roadmap Phase 1 (voice skeleton) and Phase 2 (avatar) are *not formally required* before this
  spec starts (Milestones 1–2 don't touch realtime at all), but Milestone 3 onward is, in effect,
  this project's first real implementation of `packages/realtime-core/src/session-machine.ts` —
  today that file doesn't exist, only the ASCII diagram in `docs/ARCHITECTURE.md` does.
  **ASSUMPTION**: if a dedicated "realtime voice skeleton" or "avatar renderer" spec lands
  independently before Milestone 3/4 of this one starts, this spec should consume that work rather
  than re-author it; if not, Milestones 3 and 4 below *are* that work, scoped to what this UI needs.

---

## Components Affected

- `apps/dashboard` — the screen itself, session list, shared shell
- `apps/api` — `TrainingSession`/`Message`/`UserSessionPreference` CRUD routes, ephemeral credential
  minting
- `packages/shared` — Zod schemas, `withOrg` usage, `redact()` usage
- `packages/ui` — new reusable `IconButton`, `Panel`, shared icon set
- `packages/realtime-core` — Milestone 3+ only: first real implementation of `session-machine.ts`
  and event names in `events.ts`
- `packages/avatar-core` — Milestone 4+ only: this spec *consumes* `AvatarRenderer`, it does not
  redefine the interface; the `mesh3d` implementation itself may warrant its own spec (see
  Implementation Plan)
- `apps/agent` — Milestone 7 only, Enterprise-gated, deferred
- `apps/widget` — **not affected**, out of scope, same boundary the authentication spec drew around
  the learner-facing widget

---

## Functional Requirements

1. A trainer can see a list of their org's training sessions (pinned + recent), search it, and open
   any one of them.
2. A trainer can start a brand-new `TrainingSession` against one of the org's `ACTIVE` avatars.
3. A trainer can hold a live, real-time voice+video conversation with the avatar (Mode A by
   default; Mode B for Enterprise-plan orgs, same UI either way — see Realtime Changes).
4. The active avatar's name and expertise are always visible during a live session (reuses the
   badge/overlay convention already established in `LivePreviewPanel.tsx`).
5. Live captions of the avatar's current utterance render as a burned-in overlay, separate from the
   full scrollable transcript.
6. A trainer can control the call via exactly six controls: Mute, Camera, Language, Hide Panel,
   Fullscreen, End Session (exact behaviors in UI Changes / Business Rules below).
7. The full conversation transcript persists durably per-turn (not just at session end) and is
   viewable both live and after the session ends.
8. A trainer can pin a session so it always sorts above "recent" regardless of recency.
9. Reopening an already-`ENDED` session shows its transcript read-only; it can never be rejoined
   live (new sessions only — see State Management).
10. The screen degrades gracefully (never hard-fails) on mic/camera permission denial, network
    loss, upstream AI unavailability, and avatar-provider failure.

---

## API Changes

All new, under `/v1/training-sessions`, session-authenticated (reuses whatever cookie/middleware
the Authentication spec lands), org-scoped via `withOrg(orgId, fn)`, Zod-validated. Error body
shape (same typed envelope convention as onboarding):
`{ "error": { "code": string, "message": string, "fields"?: { "path": string, "message": string }[] } }`.

**Reconciliation note**: STT/TTS/avatar-streaming are not separate REST calls. Per
`docs/ARCHITECTURE.md`, a single WebRTC peer connection (Mode A, direct to OpenAI) or LiveKit room
(Mode B, mediated by `apps/agent`) carries mic-in and model-audio-out simultaneously, and (Mode B
only) an avatar video track published by the agent worker. There is no `/stream`, `/stt`, `/tts`,
or `/avatar-stream` REST route — those capabilities collapse into **(a)** the `connect` endpoint
below, which mints the ephemeral credential, and **(b)** the browser-native realtime session it
authorizes, which is not an `apps/api` route at all. "Save transcript" is realized as incremental
per-turn `POST .../messages` calls, not a bulk end-of-session flush (see Business Rules →
auto-save).

**ASSUMPTION**: this uses a `/v1/training-sessions` namespace rather than the `POST /v1/sessions`
path illustrated in `docs/ARCHITECTURE.md` §1, because that path is almost certainly reserved for a
future learner-facing widget/embed realtime spec (a different auth model — publishable key +
learner identity JWT, not a trainer cookie session). Naming this `/v1/training-sessions` avoids
colliding with that not-yet-written spec, consistent with the `Session` vs `TrainingSession`
naming-collision precedent already established for the Prisma model.

| Method & path | Auth | Body | Success | Notes |
|---|---|---|---|---|
| `POST /v1/training-sessions` | required | `{ avatarId, title, topic?, clientRequestId }` | `201 { trainingSession }` | Creates `TrainingSession(status=ACTIVE, transportMode=<resolved by org plan>)`. `clientRequestId` (client-generated UUID) is an idempotency key — a retried request with the same key returns the original row, never a duplicate (unique DB constraint, not Redis — see Business Rules). `409 SESSION_ALREADY_ACTIVE` if the caller already has another `ACTIVE` `TrainingSession` (body includes that session's id). `400 AVATAR_NOT_ACTIVE` if the target avatar's `status !== ACTIVE`. |
| `GET /v1/training-sessions` | required | — (`?cursor=&limit=&q=`) | `200 { pinned: TrainingSessionSummary[], recent: TrainingSessionSummary[], nextCursor }` | Backs the session-list column. `pinned` = caller's `UserSessionPreference.pinned = true`, ordered by `updatedAt desc`; `recent` = the rest, same ordering, cursor-paginated (default page size 20). `q` full-text-matches `title` (naive `ILIKE` for v1 — real search indexing is a Phase 5 roadmap item, not this spec). |
| `GET /v1/training-sessions/:id` | required | — | `200 { trainingSession }` | Includes joined avatar `name`/`expertise` for header display. `404` if not found or belongs to another org (RLS-backed, not just an app-level check). |
| `GET /v1/training-sessions/:id/messages` | required | — (`?cursor=&limit=&direction=`) | `200 { messages: Message[], nextCursor }` | Fetch-history / transcript pagination. Used both for hydrating an `ENDED` session's read-only transcript and for lazy-loading older turns of a live one. |
| `POST /v1/training-sessions/:id/connect` | required | `{}` | `200 { transportMode, credentials }` | Mints ephemeral connection credentials. Mode A: `{ ekToken, expiresAt }` (`ek_*`, 60s TTL, one-time use — never logged/persisted, per `.claude/rules/realtime.md`). Mode B (Enterprise only): `{ livekitUrl, roomToken }`. `403 PLAN_NOT_ENTERPRISE` if Mode B is explicitly requested by a non-Enterprise org. `409 SESSION_ENDED` if `:id` is already `ENDED` — never resurrect (see State Management). |
| `POST /v1/training-sessions/:id/messages` | required | `{ role, content, sequence }` | `201 { message }` | Appends one finalized transcript turn. `content` passed through `redact()` (`packages/shared/src/redact.ts`) before insert, per `.claude/rules/tenancy.md` — **today that function is a no-op stub**, flagged explicitly here and to `security-reviewer`, not silently shipped as if PII scrubbing were real. `409 SESSION_ENDED` if the session is already `ENDED`. |
| `POST /v1/training-sessions/:id/end` | required | `{ reason? }` | `200 { trainingSession }` | Sets `status=ENDED`, `endedAt=now()`, computes `durationSeconds`, `endReason` (default `USER_ENDED`). **Idempotent**: ending an already-`ENDED` session returns `200` with the existing row rather than erroring (mirrors auth's logout idempotency), so a duplicate call from both a click and a `beforeunload` heartbeat is harmless. |
| `PATCH /v1/training-sessions/:id/preference` | required | `{ pinned?, lastMuted?, lastCameraOff?, lastLanguage?, transcriptVisible? }` | `200 { preference }` | Upserts the caller's `UserSessionPreference` row for this `TrainingSession`. Partial-update semantics, same convention as onboarding's draft `PATCH`. |

Every endpoint requires a two-org isolation test per `.claude/rules/tenancy.md` (named explicitly
in Testing below).

---

## Database Changes

New enums and models in `prisma/schema.prisma`, all tenant-scoped (`org_id` + RLS, per
`.claude/rules/tenancy.md` and `scripts/verify-rls.mjs`'s automatic check — no `EXEMPT_TABLES`
entries needed, unlike auth's `users`):

```prisma
enum TrainingSessionStatus {
  ACTIVE
  ENDED
}

enum TransportMode {
  MODE_A_DIRECT
  MODE_B_LIVEKIT
}

enum SessionEndReason {
  USER_ENDED
  TIMEOUT
  ERROR
  NETWORK_LOST
}

enum MessageRole {
  AVATAR
  USER
  SYSTEM
}

/// Tenant-scoped. org_id + RLS policy required — see .claude/rules/tenancy.md.
/// Core entity for this feature. Deliberately NOT named `Session` — that name
/// is owned by the authentication spec's login-session table.
model TrainingSession {
  id                String                @id @default(uuid()) @db.Uuid
  orgId             String                @map("org_id") @db.Uuid
  avatarId          String                @map("avatar_id") @db.Uuid
  createdByUserId   String                @map("created_by_user_id") @db.Uuid
  clientRequestId   String                @map("client_request_id")

  title             String
  topic             String?
  status            TrainingSessionStatus @default(ACTIVE)
  transportMode     TransportMode         @default(MODE_A_DIRECT) @map("transport_mode")
  endReason         SessionEndReason?     @map("end_reason")

  startedAt         DateTime              @default(now()) @map("started_at")
  endedAt           DateTime?             @map("ended_at")
  lastActivityAt    DateTime              @default(now()) @map("last_activity_at")
  durationSeconds   Int?                  @map("duration_seconds")

  createdAt         DateTime              @default(now()) @map("created_at")
  updatedAt         DateTime              @updatedAt @map("updated_at")

  organization      Organization          @relation(fields: [orgId], references: [id])
  avatar            Avatar                @relation(fields: [avatarId], references: [id], onDelete: Restrict)
  createdByUser     User                  @relation(fields: [createdByUserId], references: [id])
  messages          Message[]
  preference        UserSessionPreference?

  @@unique([orgId, clientRequestId])
  @@index([orgId, createdByUserId, status])
  @@index([orgId, createdByUserId, updatedAt])
  @@map("training_sessions")
}

/// Tenant-scoped. One row per finalized conversation turn. Named `Message`
/// rather than `TranscriptEntry` — "transcript" is the aggregate (a
/// TrainingSession's ordered messages), not the row.
model Message {
  id                String          @id @default(uuid()) @db.Uuid
  orgId             String          @map("org_id") @db.Uuid
  trainingSessionId String          @map("training_session_id") @db.Uuid

  role              MessageRole
  content           String          @db.Text
  redacted          Boolean         @default(false)
  sequence          Int
  createdAt         DateTime        @default(now()) @map("created_at")

  trainingSession   TrainingSession @relation(fields: [trainingSessionId], references: [id])

  @@unique([trainingSessionId, sequence])
  @@index([orgId, trainingSessionId])
  @@map("messages")
}

/// Tenant-scoped. Per-(org, user, TrainingSession) sticky UI state: pin +
/// last-used control state, so resuming a still-ACTIVE session restores
/// controls without treating them as gradeable/session-machine state.
/// NOT a general "default preferences for every new session" table — see
/// Explicit Non-Goals.
model UserSessionPreference {
  id                String          @id @default(uuid()) @db.Uuid
  orgId             String          @map("org_id") @db.Uuid
  userId            String          @map("user_id") @db.Uuid
  trainingSessionId String          @unique @map("training_session_id") @db.Uuid

  pinned            Boolean         @default(false)
  lastMuted         Boolean         @default(false) @map("last_muted")
  lastCameraOff     Boolean         @default(false) @map("last_camera_off")
  lastLanguage      String          @default("en") @map("last_language")
  transcriptVisible Boolean         @default(true) @map("transcript_visible")

  createdAt         DateTime        @default(now()) @map("created_at")
  updatedAt         DateTime        @updatedAt @map("updated_at")

  trainingSession   TrainingSession @relation(fields: [trainingSessionId], references: [id])

  @@index([orgId, userId])
  @@map("user_session_preferences")
}
```

**Additive changes to models owned by prior specs** (same precedent as onboarding extending
`User` — do not redefine `Organization`/`Avatar`/`User` here, only add back-relations Prisma
requires):

```prisma
// On Organization (owned by Phase 0):
trainingSessions TrainingSession[]

// On Avatar (owned by Onboarding spec):
trainingSessions TrainingSession[]

// On User (owned by Authentication spec):
trainingSessions      TrainingSession[]
sessionPreferences    UserSessionPreference[]
```

**Design decision**: "SessionMetadata" from the requested outline is not a separate table — its
fields (`transportMode`, `endReason`, `durationSeconds`, `startedAt`/`endedAt`/`lastActivityAt`)
live directly on `TrainingSession` since they're always read together (1:1, splitting them out is
just an unnecessary join).

**Migrations** (two, matching `prisma/migrations/` style):

1. Generated `CREATE TABLE` migration for `training_sessions`, `messages`,
   `user_session_preferences`, plus the additive columns/relations above.
2. Hand-written RLS migration, mirroring `prisma/migrations/20260805073229_enable_rls/migration.sql`:

```sql
ALTER TABLE "training_sessions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "training_sessions"
  USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "messages"
  USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE "user_session_preferences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "user_session_preferences"
  USING (org_id = current_setting('app.current_org_id')::uuid);
```

`scripts/verify-rls.mjs` needs no code change — its generic `CREATE TABLE`/RLS/`CREATE POLICY`
regex check already covers all three new tables automatically, unlike auth's `users` table which
needed an explicit `EXEMPT_TABLES` entry.

---

## UI Changes

### Layout (five regions, matching the reference screenshot)

```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ SPM MEDICARE AI                                                          (1) global top bar     │
├───────────────┬───────────────────┬─────────────────────────────────────────┬──────────────────┤
│ (2) NAV        │ (3) SESSION LIST   │            (4) MAIN VIDEO AREA           │ (5) SIDE PANEL   │
│ SIDEBAR        │ (~230px)           │            (flexible, largest column)    │ (~290px)         │
│ (~300px)       │                    │                                          │                  │
│ ┌────────────┐ │ [+ New Video Chat] │ ┌──────────────────────────────────────┐ │ YOUR CAMERA      │
│ │ AI Nancy  X│ │ [ Search...      ] │ │ ● LIVE     🔊 My Avatar · HR & Leave │ │ ┌──────────────┐ │
│ │ ENTERPRISE │ │                    │ │ Policy    ▁▃▅▂▃    [HR & Leave Pol.] │ │ │ (self webcam)│ │
│ └────────────┘ │ PINNED             │ │                                      │ │ │        ● YOU │ │
│                │ 📌 CRM v4.2 Demo   │ │                                      │ │ └──────────────┘ │
│ AI AVATAR HUB  │    Ananya·Product  │ │      <AvatarRenderer.mount()>        │ │                  │
│  ▸ New CHAT    │    ·1h ago         │ │      full-bleed avatar video         │ │ LIVE TRANSCRIPT ● │
│    Voice AI    │ 📌 Sales Pitch     │ │                                      │ │ ┌──────────────┐ │
│    Saved Convos│    Marcus·Sales    │ │                                      │ │ │ M │avatar bub│ │
│                │    Coach·Yesterday │ │ ┌──────────────────────────────────┐ │ │ │   │ user bub │ │
│ MAIN           │                    │ │ │ "...core concepts we'll cover... │ │ │ │ M │avatar bub│ │
│  Dashboard     │ RECENT             │ │ │  on **HR & Leave Policy**…"      │ │ │ │   ● ● ●      │ │
│                │ 🕐 Compliance Tr.  │ │ └──────────────────────────────────┘ │ │ └──────────────┘ │
│ ACCOUNT        │ 🕐 Support Escal.  │ │        caption bar (bottom overlay)  │ │                  │
│  Notifications │ 🕐 Onboarding WT.  │ └──────────────────────────────────────┘ │                  │
│  Help Center   │                    │  [Mute] [Camera] [Language] [Hide      │                  │
│  Profile       │                    │  Panel] [Fullscreen] [End Session]     │                  │
│ ┌────────────┐ │                    │                                          │                  │
│ │ R  Rahul S.│ │                    │                                          │                  │
│ │   Sales Tm │ │                    │                                          │                  │
│ └────────────┘ │                    │                                          │                  │
└───────────────┴───────────────────┴─────────────────────────────────────────┴──────────────────┘
```

Region (1) org brand, and the "AI Nancy / ENTERPRISE PLATFORM" persona card + dismiss-X inside
region (2), are treated as part of the persistent app shell / workspace-identity callout — **not
core to this feature**. **ASSUMPTION**: out of scope beyond generalizing the container they
already live in.

### Component breakdown

**Generalizing the sidebar out of onboarding**:

| Path | Purpose |
|---|---|
| `apps/dashboard/components/AppSidebar/AppSidebar.tsx` | Generalized from `apps/dashboard/app/onboarding/Sidebar.tsx` — same nav groups, but workspace name / user card / active-item now come from props (fed by real org/user data once auth's `GET /v1/auth/me` exists), not hardcoded strings. "New CHAT" now points at `/sessions` instead of `/`. |
| `apps/dashboard/components/AppSidebar/AppSidebar.module.css` | Ported from `Sidebar.module.css`. |
| `apps/dashboard/components/AppSidebar/AppSidebar.test.tsx` | New. |
| `apps/dashboard/app/onboarding/Sidebar.tsx` | Left in place but thinned to a re-export of `AppSidebar` (low-risk cleanup; don't destabilize an already-merged feature) — optional, flagged in Files to Modify. |
| `apps/dashboard/app/(dashboard)/layout.tsx` | Whatever the Authentication spec creates here gets extended to mount `<AppSidebar />` once, wrapping every authenticated route (sessions included), rather than each feature re-mounting its own sidebar. |

**Icon consolidation**: this feature needs many icons `apps/dashboard/app/onboarding/icons.tsx`
doesn't have yet (mic-off, camera-off, globe, panel-toggle, expand, scissors/end-call, pin, clock,
search, live-dot, waveform). Rather than forking another local `icons.tsx`, a shared set is
promoted to `packages/ui/src/icons.tsx` and this feature sources its icons from there.
**ASSUMPTION/scope decision**: onboarding's existing local `icons.tsx` is left untouched for now
(don't touch a merged feature unnecessarily) — a future cleanup can consolidate it into the shared
one; flagged, not silently done.

**New session-list column** (region 3):

| Path | Purpose |
|---|---|
| `apps/dashboard/app/(dashboard)/sessions/layout.tsx` | Renders `<SessionListColumn>` beside `{children}`; server-fetches `GET /v1/training-sessions`. |
| `apps/dashboard/app/(dashboard)/sessions/layout.module.css` | — |
| `apps/dashboard/app/(dashboard)/sessions/page.tsx` | Empty/prompt state when no `[trainingSessionId]` is selected. |
| `apps/dashboard/app/(dashboard)/sessions/SessionListColumn.tsx` | "+ New Video Chat" button, search input, PINNED/RECENT groups. |
| `apps/dashboard/app/(dashboard)/sessions/SessionListItem.tsx` | One row: title, thumbtack/clock icon, `{avatarName} · {avatarExpertise} · {relativeTime}` subtitle (per the stated assumption that this subtitle is avatar name + expertise, not session-specific data). |
| `apps/dashboard/app/(dashboard)/sessions/NewSessionModal.tsx` | **New, not in the screenshot** — avatar picker (any `ACTIVE` avatar in the org) + title input, since the screenshot doesn't capture this flow state. **ASSUMPTION**, flagged explicitly. |

**New video-chat screen** (regions 4 + 5, live under `[trainingSessionId]`):

| Path | Purpose |
|---|---|
| `apps/dashboard/app/(dashboard)/sessions/[trainingSessionId]/page.tsx` | Route entry; server-fetches `GET /v1/training-sessions/:id` + first page of messages. |
| `.../VideoChatSession.tsx` | Top-level client component; mounts `TrainingSessionContext`. |
| `.../TrainingSessionContext.tsx` | Lightweight `{ state, update(patch) }` context, same pattern as `OnboardingContext.tsx` (plain `useState`, no reducer/Zustand/Redux). |
| `.../VideoStage.tsx` + `.module.css` | Region 4: LIVE badge, header overlay (avatar name/expertise/waveform), topic pill, `AvatarRenderer.mount()` container. |
| `.../CaptionBar.tsx` | Bottom-overlay single-utterance caption, separate from the transcript panel. |
| `.../ControlBar.tsx` + `.module.css` | The 6 controls — see Business Rules for exact behavior of each. |
| `.../SidePanel.tsx` | Region 5 container, toggled as one unit by "Hide Panel". |
| `.../CameraPreview.tsx` | "YOUR CAMERA" self-view + green mic-active badge + "● YOU" label. |
| `.../TranscriptPanel.tsx` + `.../TranscriptBubble.tsx` | Scrollable chat bubbles; avatar = purple/left with "M" badge, user = gray/right, trailing 3-dot typing indicator while `thinking`/`speaking`-pending. |
| `.../EndSessionDialog.tsx` | Confirmation dialog before End Session actually ends the call (not shown in the screenshot — **ASSUMPTION**, flagged, but explicitly required by the Conversation Flow's "end confirmation" step). |

**Promoted to `packages/ui`**:

| Path | Purpose |
|---|---|
| `packages/ui/src/IconButton.tsx` | The icon-over-label control-bar button used by all 6 controls. |
| `packages/ui/src/Panel.tsx` | Generic dark rounded panel shell (session-list rows, transcript panel, camera-preview frame all reuse it). |
| `packages/ui/src/icons.tsx` | Shared icon set (see above). |

### Session Controls — exact behavior

| Control | Behavior |
|---|---|
| **Mute** (mic icon) | Toggles `enabled` on the local outbound audio track only; does **not** touch the peer connection or the session-machine phase. While muted, voice-triggered barge-in is impossible (no mic audio flows) — the avatar's speech becomes uninterruptible by voice until unmuted. Persisted as `UserSessionPreference.lastMuted`. |
| **Camera** (camera icon) | Toggles the trainer's own outbound video track — this is only the "YOUR CAMERA" self-preview, unrelated to the avatar's video, and independent of Mute. Off state shows an initials placeholder instead of freezing the last frame. Persisted as `lastCameraOff`. |
| **Language** | Opens a popover of supported languages. **ASSUMPTION**: v1 scope is the caption/transcript *display* language only, decoupled from whatever language the realtime voice model is configured for — switching the model's spoken language would require a `session.update`/reconnect and the screenshot gives no evidence either way. Persisted as `lastLanguage`. |
| **Hide Panel** | Toggles the **entire right column** (camera preview + transcript together) as one unit — confirmed literal behavior from the screenshot's exact label ("Hide Panel", not "Hide Transcript"), not an assumption. Main video area reflows to fill the freed width. Persisted as `transcriptVisible`. |
| **Fullscreen** | Calls the Fullscreen API on the session page container (not just `VideoStage`, so the control bar stays reachable). **ASSUMPTION**: exact target element, since the screenshot shows no fullscreen state. Not persisted (resets each visit); `Esc` exits natively. |
| **End Session** | The only control with distinct destructive (red) styling. Opens `EndSessionDialog` for confirmation (**ASSUMPTION** — not visible in the screenshot, but required by the Conversation Flow's "end confirmation" step). On confirm: barge-in-style teardown (stop playback → close peer connection), `POST /v1/training-sessions/:id/end`, session-machine → `ended`, screen replaces the video stage with a "Session ended — view transcript" summary card. |

---

## Realtime Changes

This is the first feature to give `packages/realtime-core/src/session-machine.ts` and
`packages/avatar-core`'s `AvatarRenderer` an actual caller. Reuses the **exact same state machine
and state names** already specified in `docs/ARCHITECTURE.md` §1 — no parallel machine is invented
for the dashboard:

```
idle → bootstrapping → connecting → listening ⇄ learner_speaking → speaking → thinking → …loop…
                              ↓ fail                                              ↑ barge-in
                        error(recoverable) ───────────────────────────────────────┘
                              ↓ fatal
                            ended (terminal — reconnects always mint a new transport session id)
```

`learner_speaking` fires whenever the human participant is talking — here that human is the
trainer, not a learner. **The state is inherited unchanged from `packages/realtime-core`, not
renamed for this surface**, so `apps/widget` and `apps/dashboard` can share one implementation.

**Transport mode resolution**: default Mode A (direct WebRTC to OpenAI, `connect` mints an `ek_*`
token, 60s TTL, one-time use, never logged/persisted). Mode B (LiveKit, `apps/agent` joins the room
and runs `AgentSession` + `AvatarSession`) only for Enterprise-plan orgs, gated behind the cost-gate
rule in `docs/ARCHITECTURE.md` §4 ("wait for a non-agent participant before starting a paid
session") — trivially satisfied here since the trainer *is* that participant. Mode B degrades to
Mode A / `mesh3d` on provider failure per the architecture's degrade table, never drops the call.

**Conversation flow** (init → greeting → user turn → AI turn → loop → completion → end
confirmation → save):

```
select/create TrainingSession → idle
  → connect() mints credential → bootstrapping
  → WebRTC/ICE handshake → connecting
  → pc.connectionState === 'connected' (no session.update before this) → listening
  → if message count === 0: trigger avatar's opening line → speaking → Message(AVATAR) persisted
  → loop:
      listening ⇄ learner_speaking (trainer talks, VAD)
      → turn ends → thinking (filler utterance within 250ms) → Message(USER) persisted
      → model responds → speaking (viseme-driven lip-sync, captions burn in) → Message(AVATAR) persisted
      → barge-in mid-speaking: stop playback → flush queue → response.cancel → mouth to neutral
        (fixed order, one animation frame) → learner_speaking
  → trainer clicks End Session → confirm dialog → teardown → ended
  → POST .../end (idempotent) finalizes duration/endReason — "save" is per-turn already, not a bulk flush
```

There is no automatic "completion" detection (that needs Phase 3's curriculum/objective/tool-registry
system, which doesn't exist) — ending is always trainer-initiated or a timeout sweep. Flagged under
Explicit Non-Goals.

**Hard constraints this spec must respect** (from `.claude/rules/realtime.md`, unchanged, cited not
re-derived): event names only from `REALTIME_EVENTS` (currently an empty const — entries land one
at a time, verified against live docs, never inlined); data channel named `oai-events`; no
`session.update` before connected; `ek_*` never logged/persisted/reused; barge-in order fixed as
above, within one animation frame; nothing new in the audio callback, metrics via
`requestIdleCallback`.

**Rule-glob gap — a design decision, not silently resolved**: `.claude/rules/realtime.md`'s path
globs (`packages/realtime-core/**`, `apps/agent/**`, `apps/widget/src/session/**`) do not currently
include `apps/dashboard/**`. **Decision**: keep all realtime-sensitive logic (the actual
`RTCPeerConnection`, the session-machine instance, barge-in handling) inside
`packages/realtime-core` behind a transport-agnostic factory (e.g. `createRealtimeSession()`), and
have `apps/dashboard` call into it as a thin consumer — so the existing rule glob already protects
the sensitive code, `apps/widget` and `apps/dashboard` share one implementation, and no rule-file
edit is needed. The alternative (putting session logic directly in
`apps/dashboard/lib/session/**` and extending the rule glob) is explicitly not preferred.

---

## State Management

Two layers, deliberately not merged into one:

1. **Conversation phase** — owned entirely by the `packages/realtime-core` session-machine instance
   (one per live `TrainingSession`), per Realtime Changes above. The dashboard UI only *subscribes*
   to phase changes; it never re-implements or duplicates the machine.
2. **UI toggle state** — a `TrainingSessionContext` (mirrors `OnboardingContext.tsx`'s exact
   pattern: plain Context + `useState`, `{ state, update(patch) }`, no reducer/Zustand/Redux)
   holding orthogonal flags: `muted`, `cameraOff`, `transcriptVisible`, `language`, `fullscreen`.
   These compose *with* whatever machine phase is active — e.g. you can be `listening` **and**
   `muted` simultaneously; mute never gates or blocks a phase transition.

Mapping the requested state list onto the real machine + orthogonal flags (no new parallel state
machine):

| Requested state | Real mechanism |
|---|---|
| Connecting | `bootstrapping` + `connecting` |
| Live | derived UI flag = phase ∈ `{listening, learner_speaking, speaking, thinking}` (drives the "● LIVE" badge) |
| Listening | `listening` |
| AI Speaking | `speaking` |
| Processing | `thinking` |
| Muted / Camera Off / Transcript Visible-Hidden | `TrainingSessionContext` flags — never modeled as session-machine states |
| Session Ended | `ended` (terminal) |
| Error | `error(recoverable)` transiently; exhausted recovery falls through to `ended` with `endReason=ERROR` — `error` is not itself terminal, `ended` is the only terminal state |

---

## Business Rules

- **Only one active session at a time**: a trainer may have only one `TrainingSession` in a
  *connected/live* state at once (a single mic/camera can't be in two calls). Enforced server-side
  on `POST /v1/training-sessions` (`409 SESSION_ALREADY_ACTIVE`, includes the existing session's id
  so the client can offer "end that one first").
- **Prevent duplicate session creation**: client disables "+ New Video Chat" during the pending
  create (mirrors onboarding's "Create Avatar & Start Session" loading-state pattern) *and* the
  server enforces a `clientRequestId` idempotency key via a DB unique constraint
  (`@@unique([orgId, clientRequestId])`) — deliberately **not** Redis, since request-dedup isn't
  session truth and `docs/ARCHITECTURE.md` §5 warns against drifting session truth into Redis.
- **Conversation automatically saved**: every finalized turn is written via `POST .../messages`
  within ~2s of turn completion — not batched at session end. `lastActivityAt` is
  heartbeat-updated (e.g. every 30s while connected) so a crashed tab doesn't leave a
  falsely-fresh-looking `ACTIVE` row forever.
- **Resume previous conversations**: only a still-`ACTIVE` session can be reconnected into, and
  doing so **continues writing to the same `TrainingSession.id`/message sequence** while always
  minting a brand-new ephemeral transport credential and transport-layer session id — this
  reconciles "reconnects always create a new [transport] session id" with "reconnect resumes the
  conversation": the *product-level* `TrainingSession` is durable across a reconnect, the
  *transport-level* realtime session inside it is not. An `ENDED` session can only be reopened
  read-only, never rejoined live.
- **Pinned sessions remain available**: `UserSessionPreference.pinned` survives session end and
  reload indefinitely (no TTL), independent of session status.
- **Handle network interruptions gracefully**: on `disconnected`/`failed`, show "Reconnecting…",
  buffer local UI state, retry ≤3 with backoff (per `docs/ARCHITECTURE.md`'s failure table),
  replay only the pedagogical-context summary (not full audio history) on reconnect. After 3 failed
  attempts → `error(recoverable)` → a user-visible fatal card offering Retry / End Session (never
  silently auto-ends — the trainer decides).
- **Session timeout**: idle beyond a configurable `TRAINING_SESSION_IDLE_TIMEOUT_MS`
  (**ASSUMPTION**: proposed 15 minutes) auto-ends server-side with `endReason=TIMEOUT`, with a
  warning toast at 2 minutes remaining so it isn't a silent surprise.

---

## Validation & Error Handling

| Case | Detection | UI behavior | Recovery path |
|---|---|---|---|
| Microphone permission denied | `getUserMedia` rejects (`NotAllowedError`) | Non-blocking "Microphone access needed" panel with enable-instructions | Fall back to text-input mode (typed `Message(USER)` rows, avatar still responds by voice+captions) — per `docs/ARCHITECTURE.md`'s failure table, not a hard stop |
| Camera permission denied | `getUserMedia({video})` rejects | "YOUR CAMERA" shows a camera-off placeholder + inline enable affordance | Session proceeds camera-off — the trainer's own video was never required for the call itself |
| Network disconnect mid-session | `connectionState`/`iceConnectionState` → `disconnected`/`failed` | "Reconnecting…" banner, avatar freezes to neutral | Retry ≤3 with backoff; on success resume in place; on exhaustion, fatal card with Retry / End Session |
| AI service unavailable (OpenAI 429/5xx) | Error event on `oai-events` data channel | "High demand — reconnecting…" toast | Backoff + retry; degrade to text-chat-only with the same tutor logic, per the architecture's degrade table |
| Empty transcript (0 `Message` rows at end) | `messages` count === 0 on `end` | Session-list row and transcript view show "No conversation recorded" | Not an error — a valid `ENDED` row is kept, not deleted (audit trail) |
| Session timeout | `lastActivityAt` stale past threshold | 2-min warning toast, then "Session ended due to inactivity" card | Trainer starts a new `TrainingSession`; prior transcript stays viewable |
| Avatar unavailable | Mode B: no video track after 5s. `mesh3d`: `webglcontextlost` | Silent visual degrade: Mode B → `mesh3d`, `mesh3d` → `voiceOnly` (waveform replaces avatar), per the architecture's degrade table | Automatic; a single non-repeating badge notes the switch; audio/captions continue uninterrupted |
| Avatar not `ACTIVE` (e.g. still `DRAFT`) | `400 AVATAR_NOT_ACTIVE` on create | Blocked before `connect` is even attempted, inline error in `NewSessionModal` | Trainer finishes onboarding for that avatar or picks another |

---

## Accessibility

- **Keyboard navigation**: all 6 controls and session-list rows reachable via Tab in visual order,
  activated with Enter/Space.
- **Screen reader support**: an `aria-live="polite"` region announces user-relevant phase
  transitions ("Avatar is speaking", "Listening", "Reconnecting") without spamming on every internal
  event. **Explicit dedup decision**: the caption bar and the transcript panel must not both fire
  live-region announcements for the same utterance — the caption bar is the single authoritative SR
  announcement source (it's the real-time single-utterance surface), and the transcript panel is
  marked `aria-hidden` for SR purposes. Flagged because the reference UI shows both surfaces
  simultaneously and a double-announcement would be a real regression if not deliberately
  deduplicated.
- **Focus management**: `EndSessionDialog` traps focus and returns it to the End Session button on
  cancel, or the resulting "ended" card's primary action on confirm. Toggling Hide Panel while
  focus is inside the panel moves focus to the Hide Panel button rather than stranding it.
- **Color contrast**: dark-theme control-bar icons/labels and pill badges meet WCAG AA (4.5:1 text,
  3:1 icon-only). The red End Session control's meaning comes from its text label, not color alone.
- **Shortcut keys**: **ASSUMPTION**, proposed as stretch scope for the hardening milestone (e.g.
  `M` mute toggle), not evidenced by the reference screenshot — guarded so they never fire while
  focus is inside the transcript/search text inputs.
- **`prefers-reduced-motion`**: honored by the `mesh3d` milestone from the start (disable idle sway/
  blink micro-animations, keep only functional viseme motion) even though the roadmap formally
  assigns this to Phase 8 — cheap to build in early rather than retrofit.

---

## Non-Functional Requirements

- **Performance**: TTFA p50 < 700ms (Mode A, Phase 1 parity), p95 < 1400ms (Mode B, Phase 6
  parity); barge-in cuts audio within 100ms.
- **Scalability**: `apps/api` stays stateless/horizontal per `docs/ARCHITECTURE.md` §5;
  session-list/message queries use the indexes above, never run against the primary in a way that
  competes with bootstrap latency.
- **Responsiveness**: **ASSUMPTION** — the reference UI's dense 4-column layout is
  desktop-oriented; v1 is desktop-only (≥1280px), with a later responsive pass (forced Hide Panel,
  session-list as an overlay drawer below that width) explicitly deferred, not blocking v1.
- **Security**: `ek_*`/LiveKit tokens never logged/persisted/reused; RLS on all three new tables;
  Mode B gated by plan; no `OPENAI_API_KEY` exposure; `redact()` applied before every `Message`
  insert (currently a no-op — flagged).
- **Reliability**: every failure mode in Validation & Error Handling has a "degrade, never drop"
  path, per the architecture's own framing.
- **Low-latency streaming**: no work added to audio callbacks/`ontrack` handlers/per-frame render
  loops; React state updates driven by realtime events stay at or below ~10Hz, per the
  `latency-auditor` agent's own checklist, cited directly.

---

## Files to Modify

- `prisma/schema.prisma` — add enums + `TrainingSession`/`Message`/`UserSessionPreference` models;
  additive back-relations on `Organization` (owned by Phase 0), `Avatar` (owned by Onboarding),
  `User` (owned by Authentication)
- `apps/api/src/app.ts` — register the new `training-sessions` route plugin
- `packages/shared/src/index.ts` — export the new `training-session` schema module
- `packages/ui/src/index.ts` — export `IconButton`, `Panel`, `icons`
- `apps/dashboard/app/onboarding/layout.tsx` — consume the generalized `AppSidebar` instead of its
  local `Sidebar`
- `apps/dashboard/app/onboarding/Sidebar.tsx` — optionally thinned to a re-export of `AppSidebar`
  (low-risk cleanup, not required)
- `apps/dashboard/app/(dashboard)/layout.tsx` — mount `AppSidebar` once for the whole authenticated
  shell (as designed by the Authentication spec; extended here if not already done)

---

## Files to Create

**`packages/shared`**
- `packages/shared/src/training-session/schema.ts`
- `packages/shared/src/training-session/schema.test.ts`
- `packages/shared/src/training-session/index.ts`

**`apps/api`**
- `apps/api/src/routes/training-sessions.ts`
- `apps/api/src/routes/training-sessions.test.ts` (incl. two-org isolation test)
- `apps/api/src/services/training-session-service.ts` (one-active-session check, idempotency,
  ended-session guards)

**`packages/ui`**
- `packages/ui/src/IconButton.tsx` (+ test)
- `packages/ui/src/Panel.tsx` (+ test)
- `packages/ui/src/icons.tsx`

**`apps/dashboard` — shared shell**
- `apps/dashboard/components/AppSidebar/AppSidebar.tsx` (+ `.module.css`, `.test.tsx`)

**`apps/dashboard` — session list**
- `apps/dashboard/app/(dashboard)/sessions/layout.tsx` (+ `.module.css`)
- `apps/dashboard/app/(dashboard)/sessions/page.tsx`
- `apps/dashboard/app/(dashboard)/sessions/SessionListColumn.tsx` (+ `.module.css`, test)
- `apps/dashboard/app/(dashboard)/sessions/SessionListItem.tsx` (+ `.module.css`, test)
- `apps/dashboard/app/(dashboard)/sessions/NewSessionModal.tsx` (+ test)

**`apps/dashboard` — video chat screen**
- `apps/dashboard/app/(dashboard)/sessions/[trainingSessionId]/page.tsx`
- `.../VideoChatSession.tsx`
- `.../TrainingSessionContext.tsx` (+ test)
- `.../VideoStage.tsx` (+ `.module.css`)
- `.../CaptionBar.tsx`
- `.../ControlBar.tsx` (+ `.module.css`, test)
- `.../SidePanel.tsx`
- `.../CameraPreview.tsx`
- `.../TranscriptPanel.tsx` + `.../TranscriptBubble.tsx`
- `.../EndSessionDialog.tsx` (+ test)

**Milestone 1 fixtures**
- `apps/dashboard/lib/fixtures/mock-training-sessions.ts`

**Prisma**
- `prisma/migrations/<timestamp>_add_training_sessions/migration.sql` (generated)
- `prisma/migrations/<timestamp>_training_sessions_rls/migration.sql` (hand-written)

---

## Dependencies

No new npm dependencies for Milestones 1–6: Mode A WebRTC is native browser `RTCPeerConnection` (no
SDK, per `docs/ARCHITECTURE.md`'s "direct WebRTC to OpenAI"); Fullscreen/MediaDevices are native
browser APIs; state management reuses plain React Context (already available). `apps/dashboard`'s
existing workspace deps on `@avatrain/shared`/`@avatrain/ui` (established by onboarding) cover
everything here.

**Future dependency, needs explicit approval, not now**: Milestone 7 (LiveKit/Mode B) will need
`livekit-server-sdk` in `apps/agent` and `livekit-client` in `apps/dashboard` — flagged the same way
authentication flagged its own new dependency, deferred to when that milestone actually starts.

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY`
- Maintain tenant isolation using `org_id`
- Keep provider-specific logic inside adapters
- Validate APIs with Zod
- Preserve the public embed SDK contract
- Keep realtime latency low
- Use strict TypeScript
- Never use `any`
- Prefer modifying existing code
- Run `pnpm verify`
- Update documentation when public APIs change

Feature-specific:

- `session-machine` phases are the single source of truth for conversation state; UI toggles
  (`muted`/`cameraOff`/`transcriptVisible`) must never be modeled as machine states.
- Never type a literal OpenAI Realtime event string inline — add missing ones to `REALTIME_EVENTS`
  one at a time, verified against live docs.
- Data channel must be `oai-events`; no `session.update` before `connected`.
- Barge-in handler order is fixed (stop playback → flush queue → `response.cancel` → mouth to
  neutral), within one animation frame.
- `ek_*` tokens: mint server-side only, never logged/persisted/reused, 60s TTL.
- `avatarId`/`createdByUserId` are foreign keys into Onboarding's/Authentication's models — do not
  redefine those models here.
- The video area is built only against `AvatarRenderer`'s interface; no direct references to
  `mesh3d` vs. `stream` anywhere in `apps/dashboard` UI code.
- `latency-auditor` invoked on any diff touching Milestone 3+ (realtime path); `pnpm bench:latency`
  output required in that PR.
- `security-reviewer` invoked on this diff given it touches token minting (`connect`) and new
  RLS-scoped tables.

---

## Testing

**Unit** (`packages/shared`): Zod schema validation for create/message/preference payloads;
idempotency-key uniqueness behavior.

**Integration** (`apps/api/src/routes/training-sessions.test.ts`, `app.inject` style):
- Create → list → get → messages → end, full happy path.
- `409 SESSION_ALREADY_ACTIVE` when a second create is attempted while one is active.
- Idempotent create (same `clientRequestId` twice → one row); idempotent `end` (called twice →
  same row, no error).
- `400 AVATAR_NOT_ACTIVE` for a `DRAFT` avatar.
- `409 SESSION_ENDED` on `connect`/`messages` against an already-`ENDED` session.
- **Two-org isolation test** (required by `.claude/rules/tenancy.md`): org A's session hitting
  `GET /v1/training-sessions` and `GET /v1/training-sessions/:id` never sees org B's rows, even
  after seeding org B with sessions/messages/preferences.

**End-to-End**: click through session-list → new session → (Milestone 2: scripted/mocked
conversation; Milestone 3+: real voice) → all 6 controls → End Session confirmation → transcript
persists on reload.

**Realtime Tests** (Milestone 3+): CI runs off recorded fixtures, no live API calls, per Phase 1's
roadmap exit criterion; barge-in order asserted explicitly.

**Latency Benchmarks** (Milestone 3+): `pnpm bench:latency` required in the PR.

**RLS-level isolation test** (`packages/shared`, DB layer): seed two orgs with
`training_sessions`/`messages`/`user_session_preferences`; prove `withOrg(orgA, ...)` returns zero
rows from org B's tables.

**Manual Verification**: `pnpm db:migrate` clean; `node scripts/verify-rls.mjs` passes for all
three new tables with no exemptions; click through the full UI matching the reference screenshot;
keyboard-only pass over all controls; verify reconnect-resumes and timeout-ends behaviors.

---

## Acceptance Criteria

- **Session creation & listing**: trainer can create a session against an `ACTIVE` avatar, see it
  appear in "recent," pin it, and have it persist across reload.
- **Video call (Mode A)**: two-way spoken conversation sustained 5 minutes with no drops; TTFA
  p50 < 700ms; barge-in cuts audio within 100ms; forced network drop reconnects and resumes.
- **Avatar rendering**: `mesh3d` mounts via `AvatarRenderer`, expression/viseme respond to
  session-machine phase and audio; WebGL loss degrades to `voiceOnly` with no console errors.
- **Session controls**: each of the 6 behaves exactly as specified above, independently of the
  others and of session-machine phase.
- **Transcript & persistence**: every finalized turn is queryable via `GET .../messages` within
  ~2s of being spoken; an `ENDED` session's transcript is viewable read-only and can never be
  rejoined live.
- **Business rules**: a second `POST /v1/training-sessions` while one is active is rejected;
  idempotent create/end verified; pin survives session end.
- **Error handling**: each row of the Validation & Error Handling table is manually verified to
  degrade rather than hard-fail.
- **Accessibility**: full keyboard path through all controls; SR announcements deduplicated between
  caption bar and transcript panel; axe-core clean on the screen.

---

## Implementation Plan

Ordered to respect `docs/ROADMAP.md`'s phase-gating — later milestones are never a prerequisite for
earlier ones.

1. **Static UI shell, mocked data** — all five layout regions, session list, control bar,
   transcript bubbles, captions, generalized `AppSidebar`, driven entirely by
   `apps/dashboard/lib/fixtures/mock-training-sessions.ts`. No API/DB/realtime involvement. Exit:
   visually matches the reference screenshot, all 6 controls toggle, clicking through mock sessions
   works.
2. **Dashboard session-list + Prisma models/API, no realtime** — the Prisma models/
   migrations/RLS above, all `apps/api` routes except `connect`'s real credential minting
   (stubbed/disabled), Milestone-1 UI rewired to real data. Exit: two-org isolation test passes,
   CRUD fully covered, pin/list persist across reload.
3. **Mode A voice-only, real connection (Phase 1 parity)** — first real
   `packages/realtime-core/src/session-machine.ts` implementation (or consume one if a dedicated
   spec lands first), real `connect` minting, real WebRTC, live captions, barge-in,
   reconnect-on-drop. Avatar area shows `voiceOnly` (waveform), not yet a rendered avatar. Exit:
   mirrors Phase 1's roadmap exit bullets exactly.
4. **`mesh3d` avatar integration (Phase 2 parity)** — mount `AvatarRenderer`, wire
   `setExpression`/`setViseme` to phase + audio, idle behaviors, LOD, `voiceOnly` fallback on WebGL
   loss. **Note**: the `mesh3d` implementation itself may warrant its own `avatar-renderer` spec;
   this milestone is scoped to consuming it at this screen's mount point. Exit: mirrors Phase 2's
   roadmap exit bullets.
5. **Transcript persistence + resume + pin hardening** — finalize per-turn writes, `end`
   idempotency, timeout sweep, resume-into-`ACTIVE` reconnect behavior, two-tab pin edge cases.
6. **Accessibility + error-state hardening** — full keyboard/SR/focus/contrast pass, every
   Validation & Error Handling row manually verified, `prefers-reduced-motion`.
7. **LiveKit / Mode B photoreal (Enterprise-gated, deferred)** — real `apps/agent` worker, cost
   gate, plan-based mode resolution, mid-session degrade to `mesh3d`. **Explicitly not required for
   the feature's initial usable version** — this is the milestone that produces the reference
   screenshot's photoreal avatar, for an Enterprise-plan org only.

---

## Definition of Done

(Full checklist applies starting Milestone 3; Milestones 1–2 are exempt from the latency-budget
line since they have no realtime surface yet.)

- Feature works end-to-end
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained
- No security regressions

---

## Explicit Non-Goals

- No automatic "module complete" / objective-based session ending — that needs Phase 3's
  curriculum/tool-registry system, not yet built.
- No org/user-level "default preferences applied to every new session" (e.g. "always start muted")
  — each new `TrainingSession` starts with hardcoded sane defaults (unmuted, camera on,
  `language=en`, panel visible); `UserSessionPreference` is per-session, not a global-defaults
  table. A follow-up `UserPreference` table (no `trainingSessionId`) would be the right place if
  this becomes a real ask.
- No transcript full-text-search indexing — `q`'s naive `ILIKE` match is a placeholder; real search
  is a Phase 5 roadmap item, not this spec.
- No mobile/narrow-viewport responsive layout — desktop-only (≥1280px) for v1.
- No spoken-language switching mid-session — the Language control governs caption/transcript
  display only in v1.
- No real PII redaction — `redact()` is still the Phase 0 no-op stub; this spec calls the hook
  correctly but does not implement real scrubbing (flagged to `security-reviewer`).
- `packages/embed`, `apps/widget`, and the Phase-4 learner-identity JWT are untouched — same
  boundary the Authentication spec drew.

---

## Implementation Assumptions

Consolidated list of every inferential leap flagged inline above:

1. The "AI Nancy / ENTERPRISE PLATFORM" persona card + its dismiss-X is treated as part of the
   persistent app shell, not core to this feature.
2. The top-right topic pill (e.g. "HR & Leave Policy") is a static duplicate of the top-center
   label, not a separate interactive filter — no interaction evidence either way in the reference
   screenshot.
3. The session-list subtitle ("`{PersonName} · {Category}`") is the linked avatar's name +
   expertise, not session-specific data.
4. This spec's realtime endpoints live under `/v1/training-sessions`, not `/v1/sessions`, to avoid
   colliding with a not-yet-written widget/learner realtime spec.
5. "+ New Video Chat" opens a `NewSessionModal` (avatar + title picker) not shown in the reference
   screenshot, since some flow state has to select which avatar to talk to.
6. The Language control scopes to caption/transcript display language only, not the realtime voice
   model's spoken language.
7. Fullscreen targets the whole session-page container, not just the video stage.
8. `EndSessionDialog` (a confirmation step) exists even though the reference screenshot doesn't
   show it — required by the explicitly requested Conversation Flow.
9. `TRAINING_SESSION_IDLE_TIMEOUT_MS` is proposed at 15 minutes — no source specifies this value.
10. v1 is desktop-only (≥1280px); responsive collapse is a later pass.
11. Optional keyboard shortcuts (e.g. `M` for mute) are proposed stretch scope, not evidenced by the
    reference screenshot.
12. SR announcement source is deduplicated to the caption bar over the transcript panel — an
    explicit design choice to avoid double-announcing the same utterance.
13. If a dedicated realtime-voice-skeleton or avatar-renderer spec lands independently before
    Milestones 3–4 start, this spec should consume that work rather than re-author it.
