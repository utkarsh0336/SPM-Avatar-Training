# Spec: Onboarding

## Overview

A mandatory 6-step wizard ("Avatar Builder Onboarding") that runs immediately after a trainer's
first successful login. It walks the trainer through configuring their first Avatar — style,
gender, appearance, outfit, name/expertise, and voice — with a persistent live preview, and ends by
creating the Avatar record and dropping the trainer into the training/dashboard surface. Until this
wizard is completed, the trainer cannot create additional avatars or start a training session.

This spec covers `apps/dashboard` (the wizard UI), `apps/api` (draft persistence + completion
endpoint), and `prisma/schema.prisma` (the `Avatar` model and an additive field on `User`). It does
not cover the Figma-accurate pixel implementation of each step — that follows once UI screenshots
are provided; this spec defines behavior, data, and structure so that pass can be a pure UI
implementation against an already-decided contract.

**Sequencing note:** `docs/ROADMAP.md` places onboarding inside Phase 5 (Trainer surface), which
formally depends on Phases 1–4 (voice loop, avatar rendering, teaching, embeddability) being done
first. This spec is being written ahead of that sequencing at explicit user request. Nothing here
blocks on Phases 1–4 — the Avatar record produced by onboarding is inert data until the realtime/
avatar-rendering layers exist to consume it — but flagging the out-of-order build for visibility.

---

## Business Goal

Trainers (the paying customer's admins/content owners) need a low-friction, opinionated setup flow
that produces a usable Avatar on the first session, rather than a blank dashboard and a wall of
unrelated settings. Forcing this as a gate:

- Guarantees every org has at least one fully-configured Avatar before anyone can start training,
  so the "create → configure → publish" funnel in the Phase 5 exit criteria has no way to stall on
  an empty state.
- Front-loads the decisions (style, gender, appearance, outfit, expertise, voice) that the realtime/
  avatar layers need at session-start time, instead of discovering missing configuration mid-session.

---

## Depends On

- **Authentication** (`feature/authentication`, not yet merged to `main` as of this spec). Onboarding
  triggers immediately after successful login, and its route guard needs a `User`/session model to
  exist. `Authentication`'s `User` model must land on `main` before this feature's migration (which
  adds `onboardingCompletedAt` to `User`) can be authored against it. Confirm the exact shape of
  `User` from that spec before implementing the migration in this one — the field name/type assumed
  here (`onboardingCompletedAt DateTime?`) is provisional.

---

## Components Affected

- `apps/dashboard` — the wizard itself, route guards, post-login redirect target
- `apps/api` — draft persistence and completion endpoints
- `packages/shared` — Zod schemas + enums shared between dashboard and api, `withOrg` usage
- `prisma/schema.prisma` — `Avatar` model, new enums, `User.onboardingCompletedAt`

`packages/avatar-core` and `packages/realtime-core` are **not** modified by this spec. The wizard's
live preview is a lightweight illustrative composite (see UI Changes), not the `mesh3d` runtime
renderer — that renderer is reserved for actual training sessions (Phase 2) and stays decoupled from
onboarding. Translating the stored `voice` tone into an actual OpenAI Realtime voice parameter is a
session-start concern for a future spec, not this one.

---

## API Changes

All routes are session-authenticated, org-scoped via `withOrg(orgId, fn)`, and Zod-validated on both
request and response shape. Base path: `/v1/onboarding`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/onboarding` | Fetch the caller's current draft Avatar (creates one on first call — see below). Returns `404`-shaped `{ draft: null }` semantics are avoided; this is a get-or-create, so it always returns a draft for an authenticated user who hasn't completed onboarding. |
| `PATCH` | `/v1/onboarding` | Partially update the draft with any subset of onboarding fields. Validates each provided field's enum/shape; does **not** require full-step completeness. Bumps `updatedAt` and `lastVisitedStep`. |
| `POST` | `/v1/onboarding/complete` | Validates that all required fields across all 6 steps are present and valid. On success: sets `Avatar.status = ACTIVE`, sets `User.onboardingCompletedAt = now()`, returns `{ avatarId }`. On failure: `400` with field-level errors, no state change. |

Rules enforced server-side, independent of client UI state:

- If the caller's `User.onboardingCompletedAt` is already set, `GET`/`PATCH` on the draft return
  `409 DRAFT_ALREADY_COMPLETED` — onboarding is a one-time gate, not a general Avatar editor.
- `POST /complete` is rejected with `400 INCOMPLETE_ONBOARDING` (with a `fields` array naming every
  missing/invalid field) if any required field is missing. The client's step-gating is a UX
  convenience; this endpoint is the actual enforcement point and must not trust it.
- Every endpoint requires a two-org isolation test per `.claude/rules/tenancy.md` — a second org's
  session must never be able to read or write the first org's draft.

---

## Database Changes

New enums and model in `prisma/schema.prisma`:

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

/// Tenant-scoped. org_id + RLS policy required — see .claude/rules/tenancy.md.
model Avatar {
  id            String        @id @default(uuid()) @db.Uuid
  orgId         String        @map("org_id") @db.Uuid
  createdById   String        @map("created_by_id") @db.Uuid

  name          String?
  style         AvatarStyle?
  gender        AvatarGender?
  skinTone      String?       @map("skin_tone")
  hairStyle     HairStyle?    @map("hair_style")
  hairColor     String?       @map("hair_color")
  outfit        Outfit?
  expertise     Expertise?
  voice         VoiceTone?

  status        AvatarStatus  @default(DRAFT)
  lastVisitedStep Int         @default(1) @map("last_visited_step")

  createdAt     DateTime      @default(now()) @map("created_at")
  updatedAt     DateTime      @updatedAt @map("updated_at")

  organization  Organization  @relation(fields: [orgId], references: [id])

  @@index([orgId])
  @@index([orgId, createdById, status])
  @@map("avatars")
}
```

Additive change to `User` (owned by Authentication, extended here):

```prisma
onboardingCompletedAt DateTime? @map("onboarding_completed_at")
```

Notes:

- `skinTone` and `hairColor` are plain `String`, **not** Postgres enums. They're validated at the
  application layer against allowlist constants in `packages/shared` (`SKIN_TONE_TOKENS`,
  `HAIR_COLOR_TOKENS`). This lets design add/adjust palette entries without a schema migration —
  accepted trade-off since this is non-sensitive cosmetic data. Exact token values are placeholders
  until the UI screenshots are reviewed; the storage shape won't need to change when they are.
- Exactly one `DRAFT` avatar per `(orgId, createdById)` is enforced at the application layer (the
  get-or-create in `GET /v1/onboarding` checks for an existing draft before inserting), not via a DB
  constraint — a user may have multiple `ACTIVE` avatars over time, just never two open drafts.
- New migration requires `org_id` + RLS policy on `avatars`, or `pnpm verify:rls` fails by design.

---

## UI Changes

### Dashboard: wizard shell

Route: `apps/dashboard/app/onboarding/[step]/page.tsx`, `step` constrained to `1`–`6`.

Layout (persistent across all 6 steps, per the prompt's "Persistent Features"):

```
┌─────────────────────────────┬───────────────────────────────┐
│                             │  ● ─ ● ─ ○ ─ ○ ─ ○ ─ ○  (1–6) │
│                             │                                │
│      Live Preview            │      <step content>           │
│      (updates on every        │                                │
│       field change)           │                                │
│                             │                                │
│                             │  [ Back ]         [ Continue ] │
└─────────────────────────────┴───────────────────────────────┘
```

- **Progress indicator**: 6 segments, current step highlighted, completed steps shown as filled/
  checked. Completed steps are clickable and jump directly there (previous selections stay editable,
  per the prompt). Steps beyond the furthest completed step are not reachable via the indicator.
- **Back**: always enabled except on step 1; navigates to `step - 1` without discarding any state.
- **Continue**: disabled until the current step's required field(s) are valid; on click, PATCHes the
  draft (if not already saved by the field-level autosave) and navigates to `step + 1`. On step 6 it
  is replaced by **"Create Avatar & Start Session"** (see Step 6 below).
- **Live Preview panel**: rendered client-side from current wizard state as a layered composite
  (style + gender + skin tone + hair style/color + outfit), not the `mesh3d` runtime renderer. Updates
  synchronously on every selection with no perceptible delay — this is asset compositing, not a 3D
  scene, so there's no latency budget concern here.

### Step 1 — Choose Avatar Style

- Three single-select cards: Realistic, Animated, 3D Stylized (`AvatarStyle`).
- Selecting a card immediately updates the live preview and enables Continue.
- No pre-selected default; Continue is disabled on first entry until a choice is made.

### Step 2 — Choose Gender

- Three single-select cards: Female, Male, Neutral (`AvatarGender`).
- Preview updates instantly; Step 1's selection remains visible/applied in the preview.

### Step 3 — Customize Appearance

- Skin Tone: single-select swatch picker (`skinTone`, allowlisted token).
- Hair Style: single-select from Short, Medium, Long, Curly, Wavy, Bald (`HairStyle`).
- Hair Color: single-select swatch picker (`hairColor`, allowlisted token).
- All three are required to Continue. Each change updates the preview independently — a learner
  should never need to touch all three before seeing any single change reflected.
- Revisiting this step later preserves and shows the previously-made selections.

### Step 4 — Choose Outfit

- Five single-select cards: Business Formal, Business Casual, Smart Professional, Tech & Creative,
  Academic/Educator (`Outfit`).
- Selected card visibly highlighted (border/checkmark treatment — exact styling from screenshots).
- Preview updates automatically on selection.

### Step 5 — Name & Expertise

- Avatar Name: free-text input, required.
  - Trimmed of leading/trailing whitespace before validation and storage.
  - Length: 2–60 characters after trim.
  - Charset: letters (incl. accented), numbers, spaces, and `- ' .` only — rejects emoji/control
    characters/other punctuation.
  - Empty or whitespace-only input shows an inline "Avatar name is required" error on blur/submit
    attempt, not on every keystroke.
- Area of Expertise: single-select from the 9-item `Expertise` enum list.
- Both fields required to Continue; inline validation errors surface without blocking typing.

### Step 6 — Voice & Final Review

- Voice: three single-select cards — Deep, Neutral, Warm (`VoiceTone`).
- Final summary block listing every collected field: Avatar Name, Avatar Style, Gender, Skin Tone,
  Hair Style, Hair Color, Outfit, Expertise, Voice. Each summary row is a plain display, not
  independently editable — to change something the trainer uses Back or the progress indicator to
  return to the owning step.
- Primary action: **"Create Avatar & Start Session."** Disabled until a voice is selected. On click:
  1. Client calls `POST /v1/onboarding/complete`.
  2. Button enters a loading state; a second click while pending is a no-op.
  3. On success, redirect to the training/dashboard page (`/dashboard` — exact target TBD against
     whatever Authentication/Phase-5 lands as the default post-onboarding home).
  4. On failure (`400 INCOMPLETE_ONBOARDING` or network error), show a non-blocking error banner
     naming the specific missing/invalid field(s) if provided, and re-enable the button. The wizard
     does **not** lose any collected state on a failed completion attempt.

---

## Realtime Changes

No realtime changes. This spec only persists Avatar configuration data. Mapping `voice` (`DEEP` /
`NEUTRAL` / `WARM`) to an actual OpenAI Realtime voice parameter, and mapping style/gender/appearance/
outfit to renderer assets, both happen at session-start time in a later spec — kept there so
provider-specific voice IDs stay inside `packages/realtime-core` adapters, per `CLAUDE.md`.

---

## State Management

Client-side wizard state lives in a React context (`OnboardingContext`), backed by `useReducer`, and
is hydrated once on mount from `GET /v1/onboarding`. This makes the server draft the source of truth
across reloads/devices, and the client context a working copy for the current tab.

```
                     ┌────────────┐
        Continue     │  step_1    │◄────────────────────────────┐
      (style valid)  │  style     │                              │ Back
             ┌───────►└─────┬──────┘                              │
             │              │ Continue                            │
             │        ┌─────▼──────┐                              │
             │        │  step_2    │                              │
             │        │  gender    │                              │
             │        └─────┬──────┘                              │
             │              │ Continue                            │
             │        ┌─────▼──────┐                              │
             │        │  step_3    │                              │
             │        │ appearance │                              │
             │        └─────┬──────┘                              │
             │              │ Continue (skin+hairStyle+hairColor) │
             │        ┌─────▼──────┐                              │
             │        │  step_4    │                              │
             │        │  outfit    │                              │
             │        └─────┬──────┘                              │
             │              │ Continue                            │
             │        ┌─────▼──────┐                              │
             │        │  step_5    │                              │
             │        │ name+exp   │                              │
             │        └─────┬──────┘                              │
             │              │ Continue (name+expertise valid)     │
             │        ┌─────▼──────┐                              │
             └────────┤  step_6    │──────────────────────────────┘
                       │voice+review│
                       └─────┬──────┘
                             │ Create Avatar & Start Session
                             │ (POST /complete succeeds)
                       ┌─────▼──────┐
                       │ completed  │  (terminal — route guard redirects
                       └────────────┘   away from /onboarding from here on)
```

- Every field change dispatches to the reducer and triggers a debounced (~500ms) `PATCH
  /v1/onboarding` autosave — so state survives a refresh even mid-step, not just between steps.
- `Continue` does not wait on the debounce; it flushes the pending PATCH immediately before
  navigating, so a fast click-through can't lose the just-made selection.
- `maxUnlockedStep` (how far the progress indicator lets you jump) is computed client-side from
  which steps have all their required fields filled, but is **not** the enforcement mechanism —
  see API Changes for why the server recomputes/enforces this independently.

---

## Navigation Behavior

- Entry point: immediately after a successful login, the post-login redirect checks
  `User.onboardingCompletedAt`. Unset → `/onboarding/1` (or the draft's `lastVisitedStep` if a draft
  with progress already exists). Set → the normal post-login destination.
- Direct URL access to any `/onboarding/[step]`:
  - Not authenticated → standard auth redirect (owned by Authentication).
  - Authenticated, `onboardingCompletedAt` already set → redirect to the normal post-login
    destination; onboarding is not re-enterable as a general editor.
  - Authenticated, requested step > server-recomputed `maxUnlockedStep` → redirect to
    `maxUnlockedStep`.
  - `step` outside `1`–`6` or non-numeric → redirect to `1`.
- Browser back/forward: since each step is a real route, native back/forward naturally maps to the
  wizard's Back/Continue and is not specially intercepted — a back-navigation to a step whose data
  is still valid just re-renders it with the preserved state.
- There is no "exit onboarding" affordance. It is mandatory; the only way out is completing it.

---

## Edge Cases

- **Refresh mid-step**: rehydrate from the server draft on mount; if the debounced autosave for the
  in-progress field hadn't fired yet, that single unsaved change is lost (accepted — see
  Implementation Assumptions).
- **Two tabs open**: last write wins by `updatedAt`; no conflict resolution UI. If tab A completes
  onboarding while tab B is still mid-wizard, tab B's next PATCH gets `409
  DRAFT_ALREADY_COMPLETED` and should redirect it to the post-onboarding destination with a toast
  ("Onboarding already completed").
- **Autosave network failure**: retried with backoff; UI shows a small non-blocking "saving…" /
  "retrying…" indicator. Continue and Back remain usable against local state regardless of autosave
  status. `POST /complete` is the one call that must succeed synchronously — its failure is shown
  inline, as described in Step 6.
- **`POST /complete` called with a stale/partial draft** (e.g., a required field was cleared in
  another tab after this tab loaded): server re-validates against its own current draft row, not
  whatever the client believes; responds `400 INCOMPLETE_ONBOARDING` with the actual missing fields.
- **User never finishes onboarding, closes the tab, comes back days later**: draft persists
  indefinitely (no TTL/expiry in this spec); resumes at `lastVisitedStep`.
- **Org has zero avatars because onboarding was abandoned**: acceptable steady state — the mandatory
  gate means the user simply cannot reach the dashboard/training surface until they finish, so
  nothing downstream needs to handle a completed-user-with-no-avatar case.

---

## Error Handling

- All API errors use a typed shape: `{ error: { code: string; message: string; fields?: { path:
  string; message: string }[] } }`. Codes used by this feature: `VALIDATION_ERROR` (400),
  `NOT_AUTHENTICATED` (401), `DRAFT_ALREADY_COMPLETED` (409), `INCOMPLETE_ONBOARDING` (400).
- Client-side field validation (name charset/length, required-selection checks) mirrors the
  server's Zod schemas so the common cases never round-trip an error — the server check is
  defense-in-depth per `.claude/rules/tenancy.md`'s general posture of not trusting the client for
  anything that gates state.
- Every mutating request is retried at most once automatically (autosave) or left to explicit user
  retry (the completion button); no infinite retry loops against a failing backend.

---

## Files to Modify

- `prisma/schema.prisma` — add enums, `Avatar` model, `User.onboardingCompletedAt`
- `apps/api/src/app.ts` — register the onboarding route plugin
- `packages/shared/src/index.ts` — export the new onboarding schema module
- `apps/dashboard/app/layout.tsx` — no structural change expected beyond whatever the Authentication
  branch already introduced there; confirm on rebase/merge with `feature/authentication`
- Whatever file in the (currently unmerged) Authentication flow performs the post-login redirect —
  update it to branch on `User.onboardingCompletedAt` per Navigation Behavior above

## Files to Create

- `packages/shared/src/onboarding/schema.ts` — Zod schemas + enums (`AvatarStyleSchema`, etc.),
  `OnboardingDraftSchema` (all fields optional), `OnboardingCompleteSchema` (all fields required),
  `SKIN_TONE_TOKENS`, `HAIR_COLOR_TOKENS` allowlists
- `packages/shared/src/onboarding/schema.test.ts`
- `packages/shared/src/onboarding/index.ts` — barrel export
- `apps/api/src/routes/onboarding.ts` — `GET`/`PATCH` `/v1/onboarding`, `POST /v1/onboarding/complete`
- `apps/api/src/routes/onboarding.test.ts` — incl. two-org isolation test
- `apps/dashboard/app/onboarding/OnboardingContext.tsx` — reducer, hydration, debounced autosave
- `apps/dashboard/app/onboarding/OnboardingContext.test.tsx`
- `apps/dashboard/app/onboarding/layout.tsx` — wizard shell: progress indicator + live preview + nav
- `apps/dashboard/app/onboarding/[step]/page.tsx` — step router/guard (redirects per Navigation
  Behavior, renders the matching step component)
- `apps/dashboard/app/onboarding/components/ProgressIndicator.tsx`
- `apps/dashboard/app/onboarding/components/LivePreviewPanel.tsx`
- `apps/dashboard/app/onboarding/components/WizardNav.tsx`
- `apps/dashboard/app/onboarding/components/SelectionCard.tsx`
- `apps/dashboard/app/onboarding/steps/StyleStep.tsx` (Step 1)
- `apps/dashboard/app/onboarding/steps/GenderStep.tsx` (Step 2)
- `apps/dashboard/app/onboarding/steps/AppearanceStep.tsx` (Step 3)
- `apps/dashboard/app/onboarding/steps/OutfitStep.tsx` (Step 4)
- `apps/dashboard/app/onboarding/steps/NameExpertiseStep.tsx` (Step 5)
- `apps/dashboard/app/onboarding/steps/VoiceReviewStep.tsx` (Step 6)
- Matching `*.test.tsx` for each component/step above
- `apps/dashboard/app/onboarding/onboarding.module.css` (+ per-component CSS Modules as needed,
  matching the existing `page.module.css` convention from the login feature)

---

## Dependencies

No new dependencies. Wizard state uses React context + `useReducer` (already available via
`react`); validation uses `zod` (already a dependency of `packages/shared`). `apps/dashboard`'s
`package.json` needs `@avatrain/shared` and `@avatrain/ui` added as **workspace** dependencies
(internal packages, not new external packages) if not already present.

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
- `skinTone`/`hairColor` stay `String` + application-layer allowlist, not new Postgres enums —
  don't "clean this up" into an enum later without re-checking the palette-flexibility trade-off
  documented above.
- Onboarding's live preview must not import from `packages/avatar-core` — keep the mandatory wizard
  decoupled from the runtime rendering pipeline.

---

## Testing

- **Unit Tests**: reducer transitions/state machine, Zod schema validation (valid/invalid enum
  values, name charset/length boundaries), allowlist token validation.
- **Integration Tests**: each API route incl. get-or-create idempotency, partial `PATCH` semantics,
  `complete` with missing fields, `complete` twice (second call hits `DRAFT_ALREADY_COMPLETED`), and
  the mandatory two-org isolation test per `.claude/rules/tenancy.md`.
- **End-to-End Tests**: no E2E framework currently exists in this repo (`playwright`/`cypress` not
  configured anywhere in the workspace as of this spec). Recommend adding one before this feature
  ships, or covering the full click-through path (login → all 6 steps → completion → redirect) as a
  React Testing Library integration test through the real `OnboardingContext` + mocked API layer as
  an interim substitute. Flagging as a gap rather than silently skipping it.
- **Realtime Tests**: none — this spec has no realtime surface.
- **Latency Benchmarks**: none — onboarding isn't on the voice/audio latency path; no
  `pnpm bench:latency` impact expected.
- **Manual Verification**: click through all 6 steps with keyboard only (tab/enter/space) and verify
  focus lands sensibly on step transitions; verify refresh-mid-step resumes correctly; verify direct
  URL step-skipping redirects as specified; verify two-tab completion race behaves per Edge Cases.

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

---

## Implementation Assumptions

Explicitly called out since the UI screenshots hadn't been provided yet when this spec was written:

1. Exact pixel layout, spacing, colors, and the precise skin-tone/hair-color swatch values are
   placeholders pending the screenshots; the data shapes above (`String` + allowlist tokens) are
   chosen to not require a schema change once real values are known.
2. Post-onboarding redirect target is assumed to be `/dashboard`; confirm against whatever route
   Phase 5's trainer surface actually lands on.
3. `User.onboardingCompletedAt` field name/type is provisional pending the merged shape of
   Authentication's `User` model.
4. A single lost unsaved field on an untimely refresh (before the ~500ms autosave debounce fires) is
   an accepted risk, not a bug to eliminate — flushing on every keystroke would be needless API load
   for a cosmetic field.
5. Avatar Name uniqueness (within or across orgs) is explicitly **not** enforced — multiple avatars
   with the same name are allowed.
6. The 9-item `Expertise` list and the enums for style/gender/hair/outfit/voice are treated as fixed
   for v1. Making them an org-configurable taxonomy is a plausible future enhancement, not in scope
   here.
