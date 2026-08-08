# Spec: Avatar Builder Customization

## Overview

Adds a realistic, customizable avatar preview to the existing Avatar Builder onboarding wizard —
reacting to Skin Tone, Hair Style, Hair Color, Outfit, Gender, and Voice — without changing the
existing wizard UI (`apps/dashboard/app/onboarding/**`) in any way. It also builds the persistence
layer the wizard has never had (an `Avatar` Prisma model and `/v1/onboarding` API, both already
designed in `.claude/specs/onboarding.md` but never implemented), extended with new fields that
reserve a path for an optional, free, flag-gated third-party avatar-generation step (Ready Player
Me) and for a future realtime talking-avatar bridge (Simli-style), without calling either vendor's
paid/realtime APIs in this pass.

Concretely, this spec covers four things:

1. Implementing `.claude/specs/onboarding.md`'s previously-unbuilt `Avatar` model and
   `GET`/`PATCH /v1/onboarding` + `POST /v1/onboarding/complete` API, since nothing else in the repo
   persists avatar configuration today.
2. A new, additive `AvatarPreviewPanel` in the wizard — a procedural, layered-composite preview that
   reacts to all six customization fields — rendered alongside (not replacing) the existing
   `LivePreviewPanel`.
3. A new `packages/avatar-core` seam (`AvatarPreviewRenderer`) for rendering a configured avatar
   outside of a live talking session, decoupled from both the wizard and the existing `AvatarProvider`
   (live-session) interface.
4. An additive, optional, feature-flagged integration with Ready Player Me's free iframe avatar
   creator as a "Generate 3D Avatar" step — evaluated in place of Avaturn, whose programmatic
   Web SDK is paid ($800/mo) and therefore ruled out — plus data-model fields that reserve (but do
   not implement) a bridge to a future Simli realtime avatar integration.

---

## Business Goal

The Avatar Builder wizard already collects every visual/voice choice a trainer makes (style, gender,
skin tone, hair style, hair color, outfit, voice), but today none of it survives past a client-only
`localStorage` handoff, and the "preview" is a flat color gradient with a generic silhouette icon —
it doesn't actually reflect any of the choices being made. This undermines the core promise of a
"builder": trainers can't see what they're building, and their configuration isn't durable across
devices, sessions, or once a real talking-avatar/Simli-style rendering pipeline exists to consume it.

Closing this gap — a real per-attribute preview, plus durable server-side persistence — is a
prerequisite for every downstream avatar-rendering feature already planned in this repo
(`ai-avatar.md`'s replica resolver, `ai-voice-livekit.md`'s `StreamAvatarRenderer`, and any future
Simli-style photoreal integration): all of them need a persisted, complete `Avatar` record to render
against. Doing this without a paid vendor also keeps the project inside the existing $0/month
constraint (`ai-avatar.md` §2) that governs every other AI/rendering integration in the codebase.

---

## Depends On

- **`.claude/specs/onboarding.md`** — this spec implements that spec's previously-undelivered
  `Avatar` Prisma model and `/v1/onboarding` API (nothing else in the repo persists avatar
  configuration), and extends it additively. Any future implementation must treat `onboarding.md`'s
  core field set (style, gender, skinTone, hairStyle, hairColor, outfit, expertise, voice, status,
  lastVisitedStep) as authoritative and unchanged; this spec only adds new nullable columns.
- **Authentication** (already merged per `.claude/specs/authentication.md`) — the onboarding routes
  require `app.authenticate` + `request.authContext.orgId`, which that spec provides.

---

## Components Affected

- `apps/dashboard` — new preview panel, optional generate-avatar flow, `OnboardingContext`
  persistence upgrade, API client additions, same-origin proxy `PATCH` support.
- `apps/api` — new `/v1/onboarding` routes and service; error-envelope extension.
- `packages/avatar-core` — new `AvatarPreviewRenderer` adapter seam + placeholder implementation.
- `packages/shared` — new `onboarding` Zod schema module.
- `prisma/schema.prisma` — new `Avatar` model, new enums, one migration.

Explicitly **not affected**: `apps/agent`, `packages/realtime-core`, `apps/widget`. This spec does
not touch the realtime/talking-avatar pipeline — it only shapes the data model so a future spec can
consume it. It also does not modify any existing onboarding wizard component's visual behavior;
`AppearanceStep.tsx`, `LivePreviewPanel.tsx`, `SwatchPicker.tsx`, etc. are unchanged.

---

## API Changes

Base path `/v1/onboarding`, session-authenticated, org-scoped via `withOrg(orgId, fn)`, Zod-validated
on request and response — implementing `.claude/specs/onboarding.md`'s design (which was never
built), extended with new optional fields.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/onboarding` | Get-or-create the caller's current draft `Avatar`. Always returns a draft for an authenticated user who hasn't completed onboarding. |
| `PATCH` | `/v1/onboarding` | Partially update the draft with any subset of fields, including the new `previewProvider`/`externalAvatarId`/`avatarModelUrl`/`avatarSnapshotUrl`. Does not require full-step completeness. Bumps `updatedAt`/`lastVisitedStep`. |
| `POST` | `/v1/onboarding/complete` | Validates all required fields from `onboarding.md`'s original 6 steps are present (style, gender, skinTone, hairStyle, hairColor, outfit, name, expertise, voice). **The four new preview fields are never required** — this is the concrete mechanism that keeps the optional vendor path non-blocking. On success: `Avatar.status = ACTIVE`, `User.onboardingCompletedAt = now()`, returns `{ avatarId }`. |

Rules (per `onboarding.md`, unchanged):

- `User.onboardingCompletedAt` already set → `GET`/`PATCH` return `409 draft_already_completed`.
- `POST /complete` with missing required fields → `400 incomplete_onboarding` naming every
  missing/invalid field; no state change.
- Every route needs a two-org isolation test per `.claude/rules/tenancy.md`.

**Error envelope**: `onboarding.md` originally specified a nested `{ error: { code, message, fields
} }` shape. The repo's actually-shipped envelope (`apps/api/src/lib/http-errors.ts`,
`apps/dashboard/lib/api-client.ts`) is flat: `{ error: string, message?: string }`. This spec
reconciles the mismatch by **extending the existing flat shape** with an optional `fields` array —
`{ error: string, message?: string, fields?: { path: string; message: string }[] }` — rather than
introducing the incompatible nested shape and touching every existing route.

**No new endpoint for avatar generation.** The optional Ready Player Me flow (see UI Changes) is a
client-side iframe + `postMessage` round trip with no API key and no server involvement — the
returned URL is written back via the already-extended `PATCH /v1/onboarding`. A server-side
vendor-proxy route is explicitly deferred (see Implementation Assumptions) and only becomes necessary
if a future vendor requires a server-held API key, which Ready Player Me's iframe flow does not.

---

## Database Changes

New enums and model in `prisma/schema.prisma` — this is the **first** implementation of the `Avatar`
table, combining `onboarding.md`'s original design with this spec's additive preview fields in one
migration:

```prisma
enum AvatarStyle {
  REALISTIC
  ANIMATED
  STYLIZED_3D
}

enum AvatarGender {
  FEMALE
  MALE
  NEUTRAL
}

enum HairStyle {
  SHORT
  MEDIUM
  LONG
  CURLY
  WAVY
  BALD
}

enum Outfit {
  BUSINESS_FORMAL
  BUSINESS_CASUAL
  SMART_PROFESSIONAL
  TECH_CREATIVE
  ACADEMIC_EDUCATOR
}

enum Expertise {
  HR_LEAVE_POLICY
  SALES_NEGOTIATION
  COMPLIANCE_LEGAL
  PRODUCT_TRAINING
  CUSTOMER_SUPPORT
  LEADERSHIP_MANAGEMENT
  FINANCE_ACCOUNTING
  IT_TECHNOLOGY
  MARKETING_BRANDING
}

enum VoiceTone {
  DEEP
  NEUTRAL
  WARM
}

enum AvatarStatus {
  DRAFT
  ACTIVE
}

/// Additive — reserved for a future, optional, free avatar-generation vendor.
/// NONE is the only value this spec's default flow ever writes; READY_PLAYER_ME
/// is only written by the flag-gated "Generate 3D Avatar" step (see UI Changes).
enum AvatarPreviewProvider {
  NONE
  READY_PLAYER_ME
}

/// Tenant-scoped. org_id + RLS policy required — see .claude/rules/tenancy.md.
model Avatar {
  id              String        @id @default(uuid()) @db.Uuid
  orgId           String        @map("org_id") @db.Uuid
  createdById     String        @map("created_by_id") @db.Uuid

  name            String?
  style           AvatarStyle?
  gender          AvatarGender?
  skinTone        String?       @map("skin_tone")
  hairStyle       HairStyle?    @map("hair_style")
  hairColor       String?       @map("hair_color")
  outfit          Outfit?
  expertise       Expertise?
  voice           VoiceTone?

  status          AvatarStatus  @default(DRAFT)
  lastVisitedStep Int           @default(1) @map("last_visited_step")

  // Additive: optional realistic-preview generation (this spec)
  previewProvider    AvatarPreviewProvider @default(NONE) @map("preview_provider")
  externalAvatarId   String?               @map("external_avatar_id")
  avatarModelUrl     String?               @map("avatar_model_url")
  avatarSnapshotUrl  String?               @map("avatar_snapshot_url")
  previewGeneratedAt DateTime?             @map("preview_generated_at")

  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  organization    Organization  @relation(fields: [orgId], references: [id])

  @@index([orgId])
  @@index([orgId, createdById, status])
  @@map("avatars")
}
```

Additive change to `User` (already exists in the live schema, confirmed — no change needed):
`onboardingCompletedAt DateTime?` is already present at `prisma/schema.prisma` (landed ahead of this
spec).

Notes:

- `skinTone`/`hairColor` stay plain `String` + application-layer allowlist tokens
  (`SKIN_TONE_TOKENS`, `HAIR_COLOR_TOKENS` in `packages/shared`), **not** Postgres enums — per
  `onboarding.md`'s original reasoning: lets the palette change without a migration. Do not "clean
  this up" into an enum later without re-checking that trade-off.
- `previewProvider`, `externalAvatarId`, `avatarModelUrl`, `avatarSnapshotUrl`, `previewGeneratedAt`
  are all nullable/defaulted and **must never be required** by the completion endpoint.
- `avatarModelUrl`/`avatarSnapshotUrl` are validated at the application layer as `z.string().url()`
  plus a **host allowlist** (the confirmed Ready Player Me asset-CDN domain — must be verified
  against a live RPM account before implementation, not guessed) so `PATCH /v1/onboarding` cannot be
  used to persist an arbitrary attacker-supplied URL. This is not an RLS/tenancy concern but follows
  the same "never trust client input for anything that gates state" posture in
  `.claude/rules/tenancy.md`.
- `avatarSnapshotUrl` is deliberately reserved now, unused by any code path in this spec, as the
  future bridge for a Simli-style integration: Simli's speech-to-video API needs a flat 2D face
  photo (not a 3D GLB mesh), so a future spec would populate this field from a rendered snapshot of
  whatever avatar asset exists, then register it as a Simli `faceId`. No Simli call is made here.
- Exactly one `DRAFT` avatar per `(orgId, createdById)`, enforced at the application layer (the
  get-or-create in `GET /v1/onboarding`), not a DB constraint — unchanged from `onboarding.md`.
- New migration requires `org_id` + RLS policy on `avatars`, or `pnpm verify:rls` fails by design.
  One migration pair (generated `CREATE TABLE avatars` + hand-written RLS policy), not two, since
  this is the table's first implementation.

---

## UI Changes

### Dashboard: existing wizard — unchanged

No existing onboarding component's markup, styling, props, or behavior changes:
`apps/dashboard/app/onboarding/[step]/page.tsx`, all six step components, `LivePreviewPanel.tsx`,
`AvatarSummaryPanel.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `WizardNav.tsx`, and every picker primitive
(`SelectionCard`, `PhotoOptionCard`, `SwatchPicker`, `PillPicker`, `RowOptionCard`,
`IconOptionCard`) are untouched.

### Dashboard: new `AvatarPreviewPanel` (additive)

- New component rendered inside `apps/dashboard/app/onboarding/[step]/layout.tsx`'s existing flex
  row, alongside (not replacing) `LivePreviewPanel`. Consumes `useOnboarding()` the same way
  `LivePreviewPanel` already does.
- Renders a **procedural, layered-composite preview**: stacked SVG/CSS-Module layers — a base
  silhouette selected by gender + style, a skin-tone fill layer, a hair-style silhouette layer tinted
  by hair color, and an outfit layer — updating synchronously on every field change, matching the
  existing panel's "no perceptible delay" behavior (this is layer compositing, not a 3D scene or
  network call).
- Does **not** import `packages/avatar-core` — same decoupling rule `onboarding.md` already applies
  to `LivePreviewPanel`, keeping the mandatory wizard independent of the runtime rendering pipeline.
- The actual SVG/illustration assets for each skin-tone/hair-style/hair-color/outfit/gender
  combination are a **content-production dependency**, not an engineering one — flagged explicitly,
  the same way `ai-avatar.md` flags idle-clip footage as "still being sourced." Implementation should
  stub against placeholder shapes if final art isn't ready, rather than blocking on it.

### Dashboard: optional "Generate 3D Avatar" step (additive, feature-flagged, built last)

- A single new button (`GenerateAvatarButton.tsx`), placed near the new preview panel, visible only
  when `NEXT_PUBLIC_AVATAR_GENERATION_ENABLED=true` (default off/unset). When disabled or the vendor
  call fails, the button either doesn't render or shows a disabled state with no effect on the rest
  of the wizard — the existing pickers and `Continue` flow work identically either way.
- On click, opens Ready Player Me's iframe avatar creator (their UI, in a modal — never replacing or
  duplicating this app's own Style/Gender/Appearance/Outfit steps) via a small non-component module,
  `ready-player-me-launcher.ts`, listening for the iframe's `postMessage` export-complete event.
- On success: calls `update({ previewProvider: "READY_PLAYER_ME", externalAvatarId, avatarModelUrl,
  previewGeneratedAt: now() })`, which flows through the same debounced/flush-on-Continue autosave as
  every other field. The returned asset is displayed as a plain `<img>` (no GLB/3D viewer dependency
  in this pass — see Dependencies).
- Requires a free Ready Player Me developer account + subdomain to obtain an embed URL — an account
  prerequisite, not a code dependency (see Implementation Assumptions).

---

## Realtime Changes

No realtime changes. This spec only persists avatar configuration and an optional preview asset URL.
Mapping `voice` to an actual TTS/Realtime voice parameter, and any future Simli `faceId` registration
using `avatarSnapshotUrl`, remain session-start concerns for a later spec — kept there so
provider-specific logic stays inside `packages/realtime-core`/`packages/avatar-core` adapters, per
`CLAUDE.md`, and so this spec's work never touches the audio hot path.

---

## State Management

`apps/dashboard/app/onboarding/OnboardingContext.tsx` is upgraded from plain `useState` to
`useReducer`, hydrated once on mount from `GET /v1/onboarding` (server draft becomes the source of
truth across reloads/devices; the client context is a working copy for the current tab) — per
`onboarding.md`'s original design, now actually implemented:

- Every field change dispatches to the reducer and triggers a debounced (~500ms) `PATCH
  /v1/onboarding` autosave.
- `Continue` flushes any pending PATCH immediately before navigating.
- The Ready Player Me launcher's success callback dispatches through the same reducer/autosave path
  as any other field — no separate persistence mechanism for the optional vendor data.
- `maxUnlockedStep` is computed client-side for the progress indicator but is not the enforcement
  mechanism — `POST /complete`'s server-side validation is (unchanged from `onboarding.md`).

---

## Edge Cases

- **Refresh mid-step**: rehydrate from the server draft; an unsaved field change from before the
  debounce fired is lost (accepted, same as `onboarding.md`).
- **Generate-avatar flow abandoned or fails**: the draft's `previewProvider` stays `NONE`
  (or whatever it already was); `POST /complete` succeeds identically since these fields are never
  required.
- **Two tabs, one completes generation while the other doesn't**: last-write-wins by `updatedAt`, no
  conflict UI — consistent with how `onboarding.md` already handles concurrent edits to any field.
- **RPM iframe returns a URL from an unexpected/unlisted host**: rejected by the host-allowlist
  validation in `PATCH /v1/onboarding`; the field is not persisted, the wizard is otherwise
  unaffected, and the user can retry or proceed without a generated avatar.
- **`POST /complete` called while a previous `Avatar` row already has a preview generated for a
  different draft (two-draft edge case)**: out of scope — `onboarding.md`'s existing one-draft-per-
  `(orgId, createdById)` invariant already prevents this.

---

## Error Handling

- Envelope: `{ error: string, message?: string, fields?: { path: string; message: string }[] }` —
  extends the existing flat shape in `apps/api/src/lib/http-errors.ts` rather than introducing a
  new nested shape. Codes used: `invalid_request` (400, existing Zod-error path), `unauthorized`
  (401, existing), `draft_already_completed` (409, new), `incomplete_onboarding` (400, new, carries
  `fields`).
- Client-side field validation for the six required steps mirrors the server's Zod schemas (per
  `onboarding.md`); the server check remains the actual enforcement point.
- The Ready Player Me `postMessage` listener validates the message's `origin` against the known RPM
  embed origin and the payload shape via Zod before ever calling `update(...)` — untrusted `postMessage`
  senders must not be able to write arbitrary state.

---

## Files to Modify

- `prisma/schema.prisma` — add `Avatar` model, new enums, in one combined definition (see Database
  Changes).
- `apps/api/src/lib/http-errors.ts` — extend `HttpError`/`handleError` to optionally carry a `fields`
  array on the existing flat envelope.
- `apps/api/src/app.ts` — register the new onboarding route plugin.
- `packages/shared/src/index.ts` — export the new `onboarding` schema module.
- `packages/avatar-core/src/index.ts` — export the new preview-renderer files.
- `apps/dashboard/app/api/[...path]/route.ts` — add a `PATCH` handler reusing the existing `proxy()`
  function (currently only `GET`/`POST` are exported — confirmed by direct read).
- `apps/dashboard/lib/api-client.ts` — add `getOnboardingDraft()`, `patchOnboardingDraft(patch)`,
  `completeOnboarding()`, following the existing `apiFetch<T>`/`ApiError` pattern.
- `apps/dashboard/app/onboarding/OnboardingContext.tsx` — `useState` → `useReducer` + hydration +
  debounced autosave (see State Management).
- `apps/dashboard/app/onboarding/types.ts` — add `previewProvider`/`externalAvatarId`/
  `avatarModelUrl`/`avatarSnapshotUrl` to `OnboardingState` with safe defaults.
- `apps/dashboard/app/onboarding/steps/VoiceReviewStep.tsx` — wire the real
  `POST /v1/onboarding/complete` call (none exists today). **Keep** the existing
  `writeOnboardingAvatarHandoff(state)` call alongside it — `useConversationSession.ts` is a live
  consumer of that localStorage handoff and must not silently break; migrating it to read the
  persisted `Avatar` record instead is an explicit follow-up, not in this spec's scope.
- `apps/dashboard/app/onboarding/[step]/layout.tsx` + `layout.module.css` — additively render
  `AvatarPreviewPanel` alongside the untouched `LivePreviewPanel`.

## Files to Create

- `prisma/migrations/<timestamp>_add_avatars/migration.sql` (generated `CREATE TABLE avatars` +
  enums) + a second hand-written migration enabling RLS + the tenant-isolation policy.
- `packages/shared/src/onboarding/schema.ts` — Zod schemas/enums (`AvatarStyleSchema`, etc.),
  `OnboardingDraftSchema` (all fields optional, incl. the 4 new preview fields),
  `OnboardingCompleteSchema` (only `onboarding.md`'s original fields required),
  `SKIN_TONE_TOKENS`/`HAIR_COLOR_TOKENS` allowlists, host-allowlist constant for preview URLs.
- `packages/shared/src/onboarding/schema.test.ts`
- `packages/shared/src/onboarding/index.ts` — barrel export.
- `apps/api/src/routes/onboarding.ts` — `GET`/`PATCH /v1/onboarding`, `POST /v1/onboarding/complete`.
- `apps/api/src/routes/onboarding.test.ts` — incl. two-org isolation test.
- `apps/api/src/services/onboarding-service.ts` — get-or-create draft, partial update, completion
  validation, all via `withOrg`.
- `packages/avatar-core/src/avatar-preview-renderer.ts` — `AvatarPreviewConfig`/`AvatarPreviewRenderer`
  interface (`render`/`update`/`destroy`), distinct from the live-session `AvatarProvider`.
- `packages/avatar-core/src/avatar-preview-renderer.test.ts`
- `packages/avatar-core/src/placeholder-avatar-preview-renderer.ts` — the $0 default implementation.
- `packages/avatar-core/src/placeholder-avatar-preview-renderer.test.ts`
- `apps/dashboard/app/onboarding/AvatarPreviewPanel.tsx` + `.module.css`
- `apps/dashboard/app/onboarding/AvatarPreviewPanel.test.tsx`
- `apps/dashboard/app/onboarding/GenerateAvatarButton.tsx` + `.module.css` (feature-flagged, built
  last)
- `apps/dashboard/app/onboarding/ready-player-me-launcher.ts` — iframe modal + `postMessage` listener
  logic kept out of the component per CLAUDE.md's "keep business logic outside React components";
  requires a `security-reviewer` pass before merge per `.claude/rules/tenancy.md`'s explicit
  postMessage rule.
- `apps/dashboard/app/onboarding/ready-player-me-launcher.test.ts`

---

## Dependencies

**No new npm dependencies.** The Ready Player Me integration uses a plain iframe embed +
`postMessage`, not an SDK package — this specifically avoids the "new dependency approval" question
by not needing one. A GLB/3D viewer library (e.g. `@google/model-viewer`, `three.js`) is explicitly
**not** added in this pass; the generated asset is shown as a flat image (see Implementation
Assumptions).

A **free Ready Player Me developer account + subdomain** is required to obtain an iframe embed URL —
this is a credential/account prerequisite, not a code dependency, and should be provisioned before
`GenerateAvatarButton`/`ready-player-me-launcher.ts` are implemented.

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

- Server-side step/completion gating must be recomputed from the persisted draft on every request,
  never trusted from client-supplied state.
- `skinTone`/`hairColor` stay `String` + application-layer allowlist, not new Postgres enums.
- `AvatarPreviewPanel` must not import from `packages/avatar-core` — keep the mandatory wizard
  decoupled from the runtime rendering pipeline, matching `LivePreviewPanel`'s existing constraint.
- The four new preview fields (`previewProvider`, `externalAvatarId`, `avatarModelUrl`,
  `avatarSnapshotUrl`) must never be added to `OnboardingCompleteSchema`'s required fields.
- `ready-player-me-launcher.ts`'s `postMessage` listener must validate both `event.origin` and the
  payload shape (Zod) before calling into state — untrusted senders must not be able to write
  arbitrary avatar state. Run `security-reviewer` on this file before merge, per
  `.claude/rules/tenancy.md`.
- `avatarModelUrl`/`avatarSnapshotUrl` must be validated against a confirmed, real host allowlist —
  do not fabricate the allowed domain; verify it against a live Ready Player Me account first.
- No Simli calls, no Simli dependency, in this spec — `avatarSnapshotUrl` is reserved, unused.

---

## Testing

- **Unit Tests**: reducer transitions/state machine (`OnboardingContext`), Zod schema validation for
  the draft/complete schemas (valid/invalid enum values, the 4 new optional fields, URL +
  host-allowlist validation), `placeholder-avatar-preview-renderer.ts`'s render/update/destroy
  lifecycle, `ready-player-me-launcher.ts`'s origin/payload validation (reject wrong origin, reject
  malformed payload, accept valid payload).
- **Integration Tests**: `apps/api/src/routes/onboarding.test.ts` — get-or-create idempotency,
  partial `PATCH` semantics (incl. the 4 new fields), `complete` with missing required fields,
  `complete` twice (`409 draft_already_completed`), `complete` succeeding with all 4 preview fields
  still `null`/`NONE` (proves non-blocking), and the mandatory two-org isolation test.
- **End-to-End Tests**: no E2E framework exists in this repo yet (same gap `onboarding.md` already
  flagged). Interim: a React Testing Library integration test through the real `OnboardingContext` +
  mocked API layer covering: full 6-step click-through → completion, and the optional
  generate-avatar flow (mocked `postMessage`) not blocking completion when skipped or failed.
- **Realtime Tests**: none — this spec has no realtime surface.
- **Latency Benchmarks**: none — this feature is not on the voice/audio latency path; no
  `pnpm bench:latency` impact expected.
- **Manual Verification**: click through all 6 steps and confirm `AvatarPreviewPanel` visually
  updates on every field change; refresh mid-step and confirm resumption from the server draft;
  confirm `Continue`/`Back`/step-jump behavior is pixel-identical to before this spec; with
  `NEXT_PUBLIC_AVATAR_GENERATION_ENABLED` unset, confirm `GenerateAvatarButton` doesn't render and
  the wizard behaves identically to a build without this spec's optional path at all; with the flag
  on, complete the RPM iframe flow and confirm the returned URL persists across a refresh.

---

## Definition of Done

- [ ] Feature works end-to-end
- [ ] All tests pass
- [ ] `pnpm verify` passes
- [ ] No lint errors
- [ ] No TypeScript errors
- [ ] Documentation updated
- [ ] Latency budget maintained
- [ ] No security regressions
- [ ] `security-reviewer` run on `ready-player-me-launcher.ts` (postMessage handling); findings
      resolved
- [ ] Existing onboarding wizard components verified byte-for-byte unchanged in the diff (no edits
      to any existing step/picker/panel component beyond the additive layout change)
- [ ] The user should be able to see the Avatar Talking with Lip Sync and there should be very less latency as much as it can be achieved.

---

## Implementation Assumptions

Explicitly called out, since several items depend on information only available with a live vendor
account or final design assets:

1. The procedural preview's actual SVG/illustration assets per skin-tone/hair-style/hair-color/
   outfit/gender combination are placeholders pending design/content production — implementation
   should stub against simple shapes rather than block on final art, mirroring `onboarding.md`'s own
   placeholder-swatch-values precedent.
2. Ready Player Me's exact `postMessage` event name/schema, whether its iframe accepts URL params or
   `postMessage` to pre-fill our existing gender/hair/skin/outfit picks, and its asset-CDN domain for
   the host allowlist are all **unverified** against a live account as of this spec — must be
   confirmed against RPM's live embed docs/dashboard before `ready-player-me-launcher.ts` is
   implemented, not guessed.
3. Whether Ready Player Me offers Avaturn-style asset-ID-level programmatic control (to fully drive
   their creator from our own picker UI instead of their iframe) is unconfirmed either way — this
   spec deliberately does not depend on that capability, using only the iframe + export-URL callback.
4. A GLB/3D viewer dependency (`@google/model-viewer`, `three.js`, etc.) is explicitly deferred — v1
   shows the generated asset as a flat image. Adding a 3D viewer is a distinct future
   dependency-approval decision.
5. Migrating `useConversationSession.ts` off the `localStorage` handoff and onto the newly-persisted
   `Avatar` record is an explicit, separate follow-up — not attempted in this spec, to avoid touching
   `video-chat-session.md`'s territory.
6. Avaturn was evaluated and explicitly rejected for this pass: its programmatic Web SDK (needed to
   avoid duplicating/replacing this app's own custom picker UI with a vendor UI) is gated behind an
   $800/mo Pro plan; its free-tier REST API's exact scope could not be verified without an account.
   If cost constraints change later, Avaturn should be re-evaluated against a live account rather than
   assumed from marketing copy.
7. Post-onboarding redirect target, `Avatar` name uniqueness, and the 9-item `Expertise`/style/
   gender/hair/outfit/voice enum sets are inherited unchanged from `onboarding.md`'s own
   Implementation Assumptions §1–6 and are not re-litigated here.
