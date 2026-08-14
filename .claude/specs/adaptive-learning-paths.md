# Spec: Adaptive Learning Paths

## Overview

`.claude/specs/adaptive-learning-personalization.md` made `getCurriculumForAvatar` learner-aware —
each objective is annotated `MASTERED` / `NEEDS_REVIEW` / `NOT_STARTED` from that learner's own
`ObjectiveProgress` — but its "Scope decisions" section explicitly declined to let that status
change *teaching order*: "Annotation, not reordering... silently reordering around progress would
break \[authored teaching dependencies\]." That left the actual reordering/reweighting half of
adaptive learning paths unbuilt, and unspecified, on top of already-shipped mastery annotation.

This spec closes that gap: a trainer-opt-in `Curriculum.adaptiveOrderingEnabled` flag that, when
set, makes `getCurriculumForAvatar` present a learner's objectives in mastery-weighted order —
objectives the learner needs review on first, unattempted ones next, already-mastered ones last —
instead of strictly the trainer's authored `order`. It is off by default, so every existing
curriculum keeps today's behavior unchanged; a trainer only takes on the "no strict prerequisite
chain" tradeoff the prior spec flagged if they explicitly ask for it.

---

## Business Goal

`.claude/specs/adaptive-learning-personalization.md`'s own Business Goal traces this feature back to
`.claude/specs/interactive-assessment.md`'s forward reference to "SOW §3.5 'adaptive learning
paths'" — and then only builds half of it (annotation), naming the other half (reordering) as an
explicit non-goal. Left alone, a returning learner who struggled on objective 2 of 5 is *told* about
it (mastery annotation already ships that), but still walks through objectives 3, 4, 5 in the
trainer's fixed order before the avatar ever circles back — remediation is deferred to whenever the
authored sequence happens to revisit it, sometimes never, if the session ends first.
`docs/ROADMAP.md` Phase 3's exit criterion "Wrong answers trigger remediation, not just 'incorrect'"
is about the immediate retry; it says nothing about *this* session, but the product's "personalized
training" pitch implies a learner's weak spots get surfaced sooner, not just flagged.

---

## Depends On

- `.claude/specs/adaptive-learning-personalization.md` — supplies `ObjectiveMasteryStatus` and the
  per-learner status computation this spec sorts by. This spec narrows, not reverses, that spec's
  "Annotation, not reordering" decision: reordering becomes possible, but only for curricula whose
  trainer explicitly opts in via the new flag. A curriculum that never sets it keeps that spec's
  original behavior byte-for-byte.
- `.claude/specs/interactive-assessment.md` — `Curriculum`/`Objective`/`ObjectiveProgress` models,
  `appendCurriculumContext`, the tool-call loop this spec's reordered list still drives unmodified.
- `.claude/specs/training-catalog.md` — the additive-optional-field-on-`UpdateCurriculumRequest`
  convention (`programType`) this spec's `adaptiveOrderingEnabled` follows verbatim.
- `.claude/specs/training-effectiveness-measurement.md` — `getCurriculumEffectiveness` sorts its
  per-objective mastery trend by authored `Objective.order` and must keep doing so unaffected by
  this spec (see Scope decisions below).

---

## Components Affected

- `apps/api` — `curriculum-service.ts`
- `apps/dashboard` — curriculum editor (`CurriculumEditor.tsx`)
- `packages/shared` — `curriculum/schema.ts`, `tutor/system-prompt.ts` (doc-comment correction only)

---

## API Changes

No new endpoints. One existing surface gains an additive, optional field, exactly like
`programType` did:

- `PATCH /v1/curricula/:curriculumId` (`apps/api/src/routes/curriculum.ts`) — request body may now
  include `adaptiveOrderingEnabled` (boolean). Handled by the existing generic patch path in
  `updateCurriculum`; no new route code.
- `GET /v1/curricula/:curriculumId`, and the `POST`/`PATCH` responses that return a full
  `CurriculumResult` — now include `adaptiveOrderingEnabled`.

```
No change to GET /v1/curricula (the org-wide summary list) — adaptiveOrderingEnabled is an
editor-detail setting, not something the curriculum-picker list needs, same as objectives
themselves are excluded from that summary today. No change to /v1/conversations/* HTTP routes —
the reordering effect is entirely inside the existing WS session.start curriculum-load path.
```

---

## Database Changes

One additive migration, same shape as `20260814130000_add_curriculum_program_type` — `Curriculum`
already has `org_id` + RLS, so an additive nullable-free boolean column on an already-RLS'd table
needs no second RLS migration:

```prisma
model Curriculum {
  // ...existing fields...

  /// Trainer opt-in: when true, getCurriculumForAvatar presents this curriculum's objectives to
  /// each learner in mastery-weighted order instead of strict authored `order`. Default false so
  /// every curriculum created before this field existed keeps today's behavior unchanged — see
  /// .claude/specs/adaptive-learning-paths.md.
  adaptiveOrderingEnabled Boolean @default(false) @map("adaptive_ordering_enabled")
}
```

No new tables, no changes to `Objective`/`ObjectiveProgress`. This is a read-time transformation of
data the product already has; `Objective.order` itself is never written by this feature.

---

## UI Changes

**Dashboard — curriculum editor.** `CurriculumEditor.tsx`'s `curriculumHeader` row (which already
holds the `programType` `<select>` next to the title) gains a checkbox: "Adaptive ordering", wired
through a `handleChangeAdaptiveOrdering` handler that mirrors `handleChangeProgramType` — same
`PATCH /v1/curricula/:curriculumId` call, same disabled-while-saving pattern. Directly under it, a
persistent helper line (not just a tooltip, since the tradeoff is real, not cosmetic):

> Reorders objectives per learner — needs-review first, then unattempted, then already mastered.
> Only enable if these objectives don't depend on being taught in a strict sequence.

```
No new pages, no new dashboard route. No UI change for the ordering logic itself — a learner's
mastery-weighted session order isn't a new thing to display; ObjectiveList in the editor still
shows and edits the trainer's authored order, which this feature never mutates.
```

---

## Realtime Changes

**1. `getCurriculumForAvatar` sorts by mastery tier when the flag is set**
(`apps/api/src/services/curriculum-service.ts:336`). After computing each objective's `status`
exactly as today, one additional step:

```ts
const MASTERY_TIER: Record<ObjectiveMasteryStatus, number> = {
  NEEDS_REVIEW: 0,
  NOT_STARTED: 1,
  MASTERED: 2,
};

const orderedObjectives = curriculum.adaptiveOrderingEnabled
  ? [...annotatedObjectives].sort((a, b) => MASTERY_TIER[a.status] - MASTERY_TIER[b.status])
  : annotatedObjectives;
```

`annotatedObjectives` is already sorted by authored `order` (existing `orderBy: { order: "asc" }`
query, unchanged). `Array.prototype.sort` is stable (guaranteed since ES2019 / all supported Node
versions), so within each tier objectives keep their authored relative order — this is a
*reweighting* of the existing sequence, not an unrelated new ordering. A curriculum with
`adaptiveOrderingEnabled: false` (the default) produces `orderedObjectives === annotatedObjectives`
in sequence, i.e. today's output, unchanged. An anonymous/embed session (`learnerId: null`) has
every objective `NOT_STARTED`, so all objectives land in the same tier and the stable sort is a
no-op regardless of the flag — consistent with
`.claude/specs/adaptive-learning-personalization.md`'s "query-shape no-op" precedent for that case.

**2. `appendCurriculumContext`** (`packages/shared/src/tutor/system-prompt.ts`) needs no code
change — it already just numbers whatever `objectives` array it's handed and includes each
objective's own `id` in the emitted list, so a reordered array produces a correctly-renumbered,
unambiguous prompt with no changes to that function. Its doc comment *does* need a correction: the
line "Objective order is never changed by mastery status" (`system-prompt.ts:154-156`) is no longer
universally true and must be updated to note it holds only when the curriculum's
`adaptiveOrderingEnabled` is unset, cross-referencing this spec.

**3. `toCurriculumResult`** (`curriculum-service.ts`) includes `adaptiveOrderingEnabled` in its
output, same additive pattern as `programType`.

**4. `updateCurriculum`**'s patch spread gains
`...(patch.adaptiveOrderingEnabled !== undefined ? { adaptiveOrderingEnabled: patch.adaptiveOrderingEnabled } : {})`,
same convention as the existing `title`/`programType` lines.

**5. Latency.** The sort runs once per `session.start`, over an already-in-memory array whose size
is a curriculum's objective count (small — single digits to low tens), immediately after the
existing per-objective status computation this spec adds nothing new to fetch. This is not expected
to move `session.ready` latency measurably, but per `.claude/rules/realtime.md` any diff to this
file requires `pnpm bench:latency` output and a `latency-auditor` review regardless — "not expected
to matter" is not a substitute for measuring it.

---

## Scope decisions

- **Opt-in, not automatic.** The prior spec's exact objection — a trainer's authored order may
  encode real teaching dependencies objective 3 assumes objective 2 just covered — is still valid in
  general. This spec doesn't solve that (it would require trainers to declare explicit prerequisite
  edges, a materially bigger feature); it sidesteps it by requiring a trainer to knowingly accept the
  tradeoff per curriculum, with the risk stated in the dashboard UI copy itself, not just in this
  spec.
- **Tier-based reweighting, not a scoring model.** Three tiers (`NEEDS_REVIEW` / `NOT_STARTED` /
  `MASTERED`), stable-sorted — no per-objective score from attempt count, recency, or time-since-last-
  review. `.claude/specs/adaptive-learning-personalization.md` already ruled out building an
  inference engine over learner signals; a numeric weighting scheme here would be exactly that,
  just smaller. Three tiers is the smallest change that satisfies "reweight toward what needs
  attention" without inventing a model to tune.
- **Never mutates `Objective.order`.** The trainer's authored order stays the single persisted
  source of truth — what `CurriculumEditor.tsx`'s `ObjectiveList` shows and edits, and what
  `getCurriculumEffectiveness` sorts its per-objective mastery trend by
  (`curriculum-service.ts:502`, `curriculumEffectivenessSchema`'s doc comment: "reading pass rate
  down this array is the mastery trend"). If adaptive ordering silently changed `order` in the DB,
  that trend would reshuffle out from under a trainer looking at aggregate analytics for reasons
  that have nothing to do with curriculum design. `getCurriculumEffectiveness` and
  `listCurriculumProgress` are untouched by this spec; both keep reading `Objective.order` exactly
  as authored.
- **Whole-objective granularity for branching scenarios.** An objective built from
  `.claude/specs/branching-scenario-questions.md`'s `ScenarioStep`s is reordered as one unit, same
  as a flat-`checkQuestion` objective — this spec doesn't reach inside a scenario's own step
  sequence, only which objective the avatar approaches next.
- **`end_module`/`getRemainingObjectiveTitles` unaffected.** That completion gate already computes
  "still not PASSed" independent of any ordering (`curriculum-service.ts:418`) — nothing here changes
  what counts as done, only the sequence in which not-yet-done objectives are presented.

---

## Files to Modify

- `prisma/schema.prisma` — `Curriculum.adaptiveOrderingEnabled`
- `packages/shared/src/curriculum/schema.ts` — `curriculumSchema` and `updateCurriculumRequestSchema`
  gain `adaptiveOrderingEnabled`
- `packages/shared/src/tutor/system-prompt.ts` — doc-comment correction on `appendCurriculumContext`
  (no logic change)
- `apps/api/src/services/curriculum-service.ts` — `getCurriculumForAvatar`'s mastery-tier sort,
  `toCurriculumResult`/`updateCurriculum` additive field
- `apps/api/src/services/curriculum-service.test.ts` — new `getCurriculumForAvatar` ordering cases
- `apps/api/src/routes/curriculum.test.ts` — `adaptiveOrderingEnabled` round-trips through
  `PATCH`/`GET /v1/curricula/:curriculumId`
- `apps/dashboard/app/(dashboard)/curriculum/CurriculumEditor.tsx` — checkbox + helper copy,
  `handleChangeAdaptiveOrdering`
- `apps/dashboard/app/(dashboard)/curriculum/CurriculumEditor.test.tsx` — toggle interaction case

## Files to Create

- `prisma/migrations/20260814170000_add_curriculum_adaptive_ordering/migration.sql`

```
No new application files. No new tables, no new routes, no new dashboard components.
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
- Maintain tenant isolation using `org_id` — `getCurriculumForAvatar`'s existing `withOrg` scoping is
  unchanged; the sort operates on data already fetched inside it
- `record_progress`/`grade_answer` remain `serverOnly` and unmodified — this feature only *reads*
  `ObjectiveProgress` (via the status it already computes), adding no new write path
- `adaptiveOrderingEnabled` is a curriculum-level, OWNER-set field via the existing `writeGate`-gated
  PATCH route — never settable by a learner or from `session.start`'s client payload
- Keep provider-specific logic inside adapters
- Validate APIs with Zod
- Preserve the public embed SDK contract — no `packages/embed` changes
- Keep realtime latency low — run `latency-auditor` and `pnpm bench:latency` before this PR, per
  `.claude/rules/realtime.md`, given the `curriculum-service.ts` diff sits in `session.start`'s path
- Use strict TypeScript; never `any`
- Prefer modifying existing code over new files
- Run `pnpm verify`
- Update documentation when public APIs change

---

## Testing

- **Unit** — `curriculum-service.test.ts`: `getCurriculumForAvatar` with `adaptiveOrderingEnabled:
  false` returns objectives in authored `order`, byte-for-byte identical to pre-this-spec behavior
  (regression guard); with it `true`, a curriculum with one `MASTERED`, one `NOT_STARTED`, and one
  `NEEDS_REVIEW` objective (authored in that order) returns them re-sorted `NEEDS_REVIEW`,
  `NOT_STARTED`, `MASTERED`; two objectives sharing a tier keep their authored relative order
  (stability); `learnerId: null` (anonymous) returns authored order regardless of the flag, since
  every objective is `NOT_STARTED`.
- **Integration** — extend the existing `session.start` test: a learner with a `RETRY`'d objective 2
  of 3 on a curriculum with `adaptiveOrderingEnabled: true` produces a system prompt (via
  `appendCurriculumContext`) listing objective 2 before objective 3; the same learner/curriculum with
  the flag `false` lists them in authored order 1, 2, 3.
- **Two-org isolation** — extend the existing curriculum isolation test: `adaptiveOrderingEnabled`
  set on an org A curriculum must not affect an org B curriculum's ordering (structurally guaranteed
  by existing `org_id` scoping — assert it directly).
- **Effectiveness regression** — `getCurriculumEffectiveness`'s `objectives` array order is asserted
  to remain authored-`order`-sorted for a curriculum with `adaptiveOrderingEnabled: true`, proving
  the two code paths stayed decoupled.
- **End-to-End (manual)** — author a 3-objective curriculum, enable adaptive ordering. As one
  learner, `RETRY` objective 2 and leave objectives 1 and 3 untouched; start a new session and
  confirm the avatar addresses objective 2 before objective 3. Toggle the flag off on the same
  curriculum and confirm a new session returns to strict authored order.
- **Realtime** — `pnpm bench:latency` before/after; `latency-auditor` review required per
  `.claude/rules/realtime.md` given the `session.start`-path diff.
- **Manual Verification** — cross-tenant: an org A trainer cannot set `adaptiveOrderingEnabled` on
  org B's curriculum via a guessed `curriculumId` (existing OWNER+RLS gate; assert unchanged).

---

## Definition of Done

- Feature works end-to-end (a curriculum with adaptive ordering enabled visibly reorders a returning
  learner's session toward their weakest objectives; a curriculum without it is byte-for-byte
  unchanged from today)
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained (`pnpm bench:latency`, `latency-auditor` reviewed)
- No security regressions (`adaptiveOrderingEnabled` OWNER-gated and `org_id`-scoped like every other
  curriculum field; no new write path to `ObjectiveProgress`; `record_progress`/`grade_answer`
  remain `serverOnly` and unmodified; `Objective.order` itself never written by this feature)
