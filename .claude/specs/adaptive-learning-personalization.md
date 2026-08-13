# Spec: Adaptive Learning Personalization

## Overview

Closes the two gaps a project status review flagged as the remaining "personalization" work on
top of `.claude/specs/interactive-assessment.md`:

1. **Adaptive teaching from progress.** `ObjectiveProgress` (PASS/RETRY, `attempts`, `feedback`)
   is recorded on every graded checkpoint (`record_progress` in
   `apps/api/src/services/conversation-service.ts`) but is currently write-only: the only two read
   paths are `end_module`'s completion gate (`getRemainingObjectiveTitles`) and a read-only
   trainer dashboard report (`listCurriculumProgress`). The objectives actually injected into the
   system prompt (`getCurriculumForAvatar`, loaded once at `session.start`) are not filtered or
   annotated by the connecting learner's history at all — a learner who already passed Objective 1
   last session is taught it again from scratch, in the same fixed order, and a RETRY'd objective
   gets no different treatment next time than one never attempted. This spec makes
   `getCurriculumForAvatar` learner-aware: it joins each objective against that learner's own
   `ObjectiveProgress` row and annotates it `MASTERED` / `NEEDS_REVIEW` / `NOT_STARTED`, and
   `appendCurriculumContext` (`packages/shared/src/tutor/system-prompt.ts`) uses that annotation to
   tell the model not to re-teach mastered material and to give a RETRY'd objective a different
   explanation (using its recorded feedback) before re-asking the check question. No new
   persistence — this is new read logic against data the product already collects.

2. **Configurable reading level.** `buildSystemPrompt` has exactly one instruction touching
   register (`system-prompt.ts:48`), and it is about spoken-turn brevity for TTS, not audience
   vocabulary/complexity — hardcoded, with no per-avatar or per-org setting anywhere in the schema
   that could carry a value for it. (`AgeGroup`/`AvatarRegion`/`AvatarLanguage` are semantically
   adjacent but are explicitly documented as inert metadata, never fed into prompt construction.)
   This spec adds a trainer-configurable `Avatar.readingLevel` (`SIMPLE` / `STANDARD` / `ADVANCED`)
   following that exact same enum-field precedent, except this one is actually consumed:
   `buildSystemPrompt` gains a `readingLevel` parameter that selects real instruction text.

### Scope decisions

- **Annotation, not reordering.** Mastery status changes what the model is told to do with each
  objective, not the order objectives are taught in. A trainer's authored `order` may encode
  real teaching dependencies (objective 3 assumes objective 2 was just covered); silently
  reordering around progress would break that. "Skip already-passed" is implemented as an
  instruction to the model ("don't re-teach this"), not as removing the objective from the list —
  `end_module`/`getRemainingObjectiveTitles` already independently and correctly gate completion
  per learner, unaffected by this change.
- **No auto-detected difficulty/reading level.** Both signals used here are ones the product
  already has server-side custody of: `ObjectiveProgress.verdict` (server-graded, never a model
  self-report) and a trainer-set `Avatar.readingLevel`. This spec does not build a model that
  infers a learner's reading level or knowledge state from their speech/text — that is a distinct,
  much larger feature (an actual ML/heuristic inference engine), not implied by either status-report
  gap, and not built here.
- **`readingLevel` is avatar-scoped (audience-wide), not learner-scoped.** Same granularity as
  `AgeGroup`/`AvatarRegion` — a trainer sets one reading level for who the avatar is speaking to in
  general (e.g., "this compliance avatar should use plain language for frontline staff"), not a
  per-learner override. A per-learner reading-level preference is a plausible future layer but adds
  a second signal source (learner self-report vs. trainer intent) this spec doesn't need to
  arbitrate.
- **No cross-avatar or cross-curriculum learner profile.** Mastery status is computed fresh per
  `(objectiveId, learnerId)` from the existing `ObjectiveProgress` table on every `session.start` —
  there is no new aggregated "learner model" table. `ObjectiveProgress` already is the durable
  per-learner state (`docs/ARCHITECTURE.md` §3: "Pedagogical state (objective, attempts) —
  Postgres, written through `record_progress` — Permanent"); this spec is the first thing that
  reads it back for that stated purpose.
- **Anonymous (embed, unsigned) sessions are unaffected.** `.claude/rules/tenancy.md`: "Unsigned
  identity may never write to `ObjectiveProgress`." Since such sessions never have progress rows to
  begin with, passing `learnerId: null` into the new join is a query-shape no-op, not a new
  business-logic branch — every objective resolves to `NOT_STARTED`, i.e. today's behavior.

---

## Business Goal

`docs/ROADMAP.md` Phase 3's exit criteria already requires "Wrong answers trigger remediation, not
just 'incorrect'" and "`ObjectiveProgress` reflects the session accurately" — the second half is
true today (progress is recorded accurately), but the remediation half only happens within a single
turn's immediate retry, never informed by history, and never carried into a *new* session.
`.claude/specs/interactive-assessment.md` itself forward-references this exact gap: "the
prerequisite architecture (tool-calling support in `LLMProvider`) that any later SOW §3.5 'adaptive
learning paths' ... work will build on" — this spec is that later work, built on exactly the
architecture that spec called out (the tool loop, `ObjectiveProgress`, `appendCurriculumContext`).
The reading-level control is the second gap named in the same status review (tracked there against
SOW §3.2); without it, a compliance-training avatar aimed at frontline hourly staff and one aimed at
legal counsel are forced to sound identical, which undercuts the product's core "personalized
training" pitch as directly as the missing adaptive-teaching logic does.

---

## Depends On

- `.claude/specs/interactive-assessment.md` — `Curriculum`/`Objective`/`ObjectiveProgress` models,
  the tool-call loop, `appendCurriculumContext`, `getCurriculumForAvatar`. This spec modifies
  functions that one introduced; it does not re-litigate its scope decisions.
- `.claude/specs/avatar-builder-customization.md` — the `AgeGroup`/`AvatarRegion`/`AvatarLanguage`
  additive-enum-field convention `readingLevel` follows end to end (Prisma enum → Zod schema →
  generic PATCH → dashboard `PillPicker`).

---

## Components Affected

- `apps/api` — `curriculum-service.ts`, `conversation-service.ts`, `avatar-service.ts`
- `apps/dashboard` — onboarding wizard (`PersonaDetailsStep.tsx`, `OnboardingContext.tsx`,
  `types.ts`) and the persona editor (`AvatarEditor.tsx`)
- `packages/shared` — `tutor/avatar-config.ts`, `tutor/system-prompt.ts`, `onboarding/schema.ts`,
  `avatar/schema.ts`

---

## API Changes

No new endpoints. Two existing surfaces gain an additive, optional field, exactly like
`ageGroup`/`region`/`preferredLanguage` did:

- `PATCH /v1/avatars/:avatarId` (`apps/api/src/routes/avatars.ts`) — request body may now include
  `readingLevel`. Handled by the existing generic `updateAvatar` patch path; no new route code.
  Still OWNER-gated, unchanged.
- `GET /v1/avatars/mine`, `GET /v1/avatars/:avatarId`, `GET /v1/avatars/all` — returned `avatar`
  object(s) now include `readingLevel`.
- `GET`/`PATCH /v1/onboarding` — draft body/response now includes `readingLevel`, never
  completion-required (same as the three existing metadata fields).

```
No changes to /v1/curricula/* or /v1/conversations/* HTTP routes. The adaptive-teaching change is
entirely inside the existing WS session.start curriculum-load path.
```

---

## Database Changes

One additive migration. `Avatar` already has `org_id` + RLS from Phase 0, so — matching the
precedent of `20260813190000_add_avatar_age_region_language` (also a single migration, no RLS pair
needed for an additive nullable column on an already-RLS'd table) — this is one migration, not two:

```prisma
/// Additive avatar-configuration attribute. Unlike AgeGroup/AvatarRegion/AvatarLanguage (metadata
/// only), this one is actually consumed — see tutor/system-prompt.ts's buildSystemPrompt and its
/// READING_LEVEL_INSTRUCTION map. Trainer-set, audience-wide; not a per-learner preference — see
/// .claude/specs/adaptive-learning-personalization.md's Scope decisions.
enum ReadingLevel {
  SIMPLE
  STANDARD
  ADVANCED
}
```

Added to `Avatar`:

```prisma
readingLevel ReadingLevel? @map("reading_level")
```

No new tables. The adaptive-teaching half of this spec adds new *queries* against the existing,
already-RLS'd `Objective`/`ObjectiveProgress` tables — no new persisted state.

---

## UI Changes

**Dashboard — onboarding wizard.** `PersonaDetailsStep.tsx` gains a fourth `PillPicker` ("READING
LEVEL": Simple / Standard / Advanced) alongside the existing Age Group / Region / Preferred
Language pickers, wired through `OnboardingContext` the same way.

**Dashboard — persona editor.** `AvatarEditor.tsx` (`app/(dashboard)/avatars/[avatarId]/`) gains
the same `PillPicker`, matching its existing Age Group/Region/Language fields.

```
No new pages. No UI change for the adaptive-teaching engine itself — a learner's per-objective
mastery state is already visible via the existing Curriculum admin page's ProgressTable.tsx
(GET /v1/curricula/:id/progress); this spec doesn't add a second view of the same data.
```

---

## Realtime Changes

**1. `getCurriculumForAvatar` becomes learner-aware**
(`apps/api/src/services/curriculum-service.ts`). New signature:

```ts
export type ObjectiveMasteryStatus = "NOT_STARTED" | "NEEDS_REVIEW" | "MASTERED";

export async function getCurriculumForAvatar(
  orgId: string,
  avatarId: string,
  learnerId: string | null,
): Promise<SessionCurriculum | null>
```

Joins `Objective` with `ObjectiveProgress` scoped to `learnerId` (the existing
`@@unique([objectiveId, learnerId])` guarantees at most one matching row), still inside `withOrg`.
Per objective: no row → `NOT_STARTED`; `verdict: PASS` → `MASTERED`; `verdict: RETRY` →
`NEEDS_REVIEW` (carrying that row's `feedback` and `attempts`). `learnerId: null` (anonymous/embed
sessions) skips the join entirely and returns every objective `NOT_STARTED` — today's behavior,
unchanged.

`SessionCurriculumObjective` (same file) gains `status: ObjectiveMasteryStatus`, `lastFeedback?:
string`, `attempts?: number`.

**2. `appendCurriculumContext`** (`packages/shared/src/tutor/system-prompt.ts`) — its
`CurriculumContextObjective` input type gains the same three fields, and its generated prompt text
annotates each objective with its status:

```
1. [id: xxx] Objective title (already MASTERED — do not re-teach; only revisit if the learner
   explicitly brings it up)
2. [id: yyy] Objective title (NEEDS_REVIEW — the learner struggled here before: "<lastFeedback>".
   Explain it a different way before re-asking the check question.)
3. [id: zzz] Objective title (not yet attempted)
```

plus an instruction: only call `start_checkpoint`/`grade_answer`/`record_progress` for objectives
that are not already `MASTERED`. Objective order is unchanged (the annotation changes *how* an
objective is taught, not *when*).

**3. `conversation-service.ts`'s `session.start` handler** passes `claims.userId ?? null` as the
new third argument to `getCurriculumForAvatar` (line ~681-684 today). `end_module` /
`getRemainingObjectiveTitles` are untouched — they already compute per-learner completion
correctly.

**4. Reading level.** `buildSystemPrompt`'s input gains an optional `readingLevel?: ReadingLevel`,
and a `READING_LEVEL_INSTRUCTION: Record<ReadingLevel, string>` map (same shape as the existing
`LANGUAGE_INSTRUCTION`) is folded into the generated prompt. Undefined defaults to the `STANDARD`
wording, so an avatar with no `readingLevel` set keeps materially the same behavior it has today.

`conversation-service.ts`'s `session.start` handler resolves `readingLevel` **server-side only**,
never from the client-supplied `session.start` message — extending the existing "embed sessions
never trust client-supplied persona fields" posture (today applied to `avatarName`/`expertise`/
`voiceTone`/`gender` for the `claims.pinnedAvatarId` branch) to this field, and to the previously-
untouched non-pinned branch too, since reading level is trainer policy, not something a caller
should set:

- `claims.pinnedAvatarId` set (embed) → read `readingLevel` off the `pinned` `Avatar` record
  already being loaded in that branch. No new query.
- `claims.pinnedAvatarId` unset but `effectiveAvatarId` (`message.avatarId`) present (dashboard
  rehearsal) → **new**: call `loadAvatarById(claims.orgId, effectiveAvatarId)` to read
  `readingLevel`. This is a new session-bootstrap DB round trip for a case that previously made no
  avatar-table query at all.
- Neither set → `readingLevel` stays `undefined` (→ `STANDARD` wording), unchanged.

**5. Latency.** Both changes sit entirely in `session.start` (once per WS connection) and
`appendCurriculumContext` (already called once per session, not per turn) — neither touches the
per-turn hot path `.claude/rules/realtime.md` protects. The new non-pinned-session `getAvatarById`
call is the one genuinely new cost and must be benchmarked, not assumed free — `pnpm bench:latency`
output and a `latency-auditor` review are required for this PR per that rules file, with particular
attention to `session.ready` latency for rehearsal sessions (previously: curriculum lookup only,
bounded by `CURRICULUM_LOAD_TIMEOUT_MS`; now: + one indexed avatar lookup).

---

## Files to Modify

- `prisma/schema.prisma` — `ReadingLevel` enum, `Avatar.readingLevel` field
- `packages/shared/src/tutor/avatar-config.ts` — `readingLevelSchema`, `ReadingLevel` type
- `packages/shared/src/tutor/system-prompt.ts` — `ObjectiveMasteryStatus` type,
  `BuildSystemPromptInput.readingLevel`, `READING_LEVEL_INSTRUCTION`, updated
  `CurriculumContextObjective`/`appendCurriculumContext`
- `packages/shared/src/tutor/system-prompt.test.ts` — new cases for both changes
- `packages/shared/src/tutor/avatar-config.test.ts` — drift-guard case for `readingLevelSchema`
- `packages/shared/src/onboarding/schema.ts` — `readingLevel` on `onboardingDraftSchema` /
  `onboardingDraftResponseSchema`
- `packages/shared/src/avatar/schema.ts` — `readingLevel` on `avatarRecordSchema`
- `apps/api/src/services/avatar-service.ts` — `toAvatarRecord` includes `readingLevel`
- `apps/api/src/services/curriculum-service.ts` — `getCurriculumForAvatar` learner-aware join +
  status computation
- `apps/api/src/services/curriculum-service.test.ts` — new `getCurriculumForAvatar` cases
- `apps/api/src/services/conversation-service.ts` — `session.start`: pass `learnerId`, resolve
  `readingLevel` on both branches, thread into `buildSystemPrompt`
- `apps/api/src/services/conversation-service.test.ts` — update the existing
  `getCurriculumForAvatar` call-signature assertion (currently 2-arg); add mastery-status and
  reading-level cases for both pinned and non-pinned sessions
- `apps/api/src/routes/avatars.test.ts` — `readingLevel` round-trips through PATCH/GET
- `apps/dashboard/app/onboarding/types.ts` — `ReadingLevel` type, `READING_LEVEL_LABELS`,
  `OnboardingState.readingLevel` + `INITIAL_ONBOARDING_STATE` default
- `apps/dashboard/app/onboarding/OnboardingContext.tsx` — `readingLevel` in the draft-hydration
  reducer and `buildPatchPayload`
- `apps/dashboard/app/onboarding/steps/PersonaDetailsStep.tsx` — new `PillPicker`
- `apps/dashboard/app/(dashboard)/avatars/[avatarId]/AvatarEditor.tsx` — new `PillPicker`,
  `EditorFormState`/`DEFAULTS`/`toFormState`

## Files to Create

- `prisma/migrations/<ts>_add_avatar_reading_level/migration.sql`

```
No new application files — every other change is additive to an existing file. No new tables, no
new routes, no new components beyond one more PillPicker instance in two existing forms.
```

---

## Dependencies

```
No new dependencies.
```

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY` (n/a here — no provider changes)
- Maintain tenant isolation using `org_id` — `getCurriculumForAvatar`'s new join stays inside
  `withOrg`, same as today
- `record_progress`/`grade_answer` remain `serverOnly` and unmodified by this spec — this feature
  only *reads* `ObjectiveProgress`; it adds no new write path
- `readingLevel` is resolved server-side from the `Avatar` record only, never accepted from the
  client's `session.start` message
- Keep provider-specific logic inside adapters
- Validate APIs with Zod
- Preserve the public embed SDK contract — no `packages/embed` changes
- Keep realtime latency low — run `latency-auditor` and `pnpm bench:latency` before this PR, per
  `.claude/rules/realtime.md`, given the `conversation-service.ts` diff
- Use strict TypeScript; never `any`
- Prefer modifying existing code over new files
- Run `pnpm verify`
- Update documentation when public APIs change

---

## Testing

- **Unit** — `curriculum-service.test.ts`: `getCurriculumForAvatar` returns `NOT_STARTED` for a
  learner with no progress row, `MASTERED` for a `PASS`, `NEEDS_REVIEW` + carried `feedback` for a
  `RETRY`, and all-`NOT_STARTED` when `learnerId` is `null`. `system-prompt.test.ts`:
  `appendCurriculumContext`'s per-status annotation text and tool-usage instructions;
  `buildSystemPrompt`'s `READING_LEVEL_INSTRUCTION` selection per level and its `STANDARD` default
  when `readingLevel` is omitted. `avatar-config.test.ts`: drift-guard case for
  `readingLevelSchema` against the wizard's own `ReadingLevel` union.
- **Integration** — `conversation-service.test.ts`: a `session.start` for a learner with one
  `MASTERED` and one `NEEDS_REVIEW` objective produces a system prompt containing the expected
  annotations (assert against the fake `LLMProvider`'s received `systemPrompt`); reading-level
  resolution for both the pinned (embed) and non-pinned (rehearsal) branches, including asserting
  the new `getAvatarById` call happens exactly once at `session.start`, never per turn.
  `avatars.test.ts`: `readingLevel` round-trips through `PATCH`/`GET /v1/avatars/:avatarId`.
- **Two-org isolation** — extend the existing curriculum isolation test: a learner's
  `ObjectiveProgress` in org A must never affect the computed status for the same `objectiveId` in
  org B (structurally guaranteed by existing `org_id` scoping on both tables — assert it directly
  rather than only relying on the schema).
- **End-to-End (manual)** — author a 2-objective curriculum; as one learner, `PASS` objective 1 and
  `RETRY` objective 2 once in session A; start session B as the same learner and confirm the avatar
  does not re-teach objective 1 from scratch and opens objective 2 with a different explanation
  referencing the earlier miss. Set an avatar's `readingLevel` to `SIMPLE` vs. `ADVANCED` and
  confirm a rehearsal session's replies to the same question visibly differ in vocabulary/sentence
  complexity.
- **Realtime** — `pnpm bench:latency` before/after; confirm the new non-pinned-session avatar
  lookup does not regress `session.ready` latency beyond the existing bootstrap-DB-call budget
  class; `latency-auditor` review required.
- **Manual Verification** — cross-tenant: an org A trainer cannot set `readingLevel` on org B's
  avatar via a guessed `avatarId` (existing OWNER+RLS gate; assert unchanged).

---

## Definition of Done

- Feature works end-to-end (a returning learner's already-passed objectives are skipped and RETRY'd
  ones are remediated differently; `readingLevel` visibly changes an avatar's phrasing)
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained (`pnpm bench:latency`, `latency-auditor` reviewed) — including the new
  session-start avatar lookup for non-pinned/rehearsal sessions
- No security regressions (`readingLevel` never client-trusted; the new `ObjectiveProgress` read
  path stays `org_id`-scoped inside `withOrg`; no new write path to `ObjectiveProgress`;
  `record_progress`/`grade_answer` remain `serverOnly` and unmodified)
