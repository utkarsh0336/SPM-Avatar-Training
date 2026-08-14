# Spec: Branching Scenario Questions

## Overview

Today, per `.claude/specs/interactive-assessment.md`, every `Objective` is checked with exactly
one flat `checkQuestion`/`gradingCriteria` pair: `start_checkpoint` → the avatar asks that one
question → `grade_answer` judges the answer PASS/RETRY → `record_progress` persists it. This spec
adds an optional, per-objective **branching scenario**: an ordered sequence of `ScenarioStep`s,
each with its own prompt and a set of trainer-authored `ScenarioBranch`es. After the learner
answers a step, an LLM judge picks the best-matching branch — which either continues to another
step (a different follow-up depending on what they said) or terminates the checkpoint with a
PASS/RETRY verdict, feeding `record_progress` exactly as `grade_answer` does today. An objective
with no `ScenarioStep`s behaves exactly as before — this is additive, not a replacement.

---

## Business Goal

SOW §3.5, quoted already in `interactive-assessment.md`'s own Business Goal: "Interactive
learning sessions... Knowledge assessments... **Scenario-based questioning**... Training
effectiveness measurement." Three of those four are already built
(`.claude/specs/interactive-assessment.md`, `.claude/specs/training-effectiveness-measurement.md`)
— this spec is the fourth. Without it, "checkpoints" can only ever be a single Q&A pair; a
compliance-training avatar can't run "a customer complains X — what do you say? [answer] — they
escalate — now what? [answer]"-style branching roleplay, which is the concrete gap a trainer
authoring realistic scenario training hits today.

---

## Depends On

- `.claude/specs/interactive-assessment.md` (owns `Objective`, the checkpoint tool loop in
  `conversation-service.ts`, and `ObjectiveProgress` — this spec's terminal branches feed
  `record_progress` unchanged)
- `.claude/specs/authentication.md` (`requireRole("OWNER")` gating for the new authoring route)

---

## Components Affected

- `apps/api` — new `scenario-service.ts`/`scenario.ts` route; `curriculum-service.ts` and
  `conversation-service.ts` extended
- `apps/dashboard` — new per-objective scenario editor on the Curriculum admin page
- `packages/shared` — new `curriculum` schemas, a 5th `LLMToolDefinition`, a new server WS message

---

## API Changes

New route, its own file (`apps/api/src/routes/scenario.ts`), matching the existing precedent of
`checklist.ts` being a separate registered route file for a curriculum-adjacent sub-resource
rather than bloating `curriculum.ts` further:

- `PUT /v1/objectives/:objectiveId/scenario` — `{ preHandler: [app.authenticate,
  requireRole("OWNER")] }` (same gate as `PUT /v1/curricula/:id/objectives` — content authoring
  stays OWNER-only, no PARTNER access, matching precedent). Body:

  ```ts
  {
    steps: Array<{
      order: number;               // 0-based, unique within this payload
      prompt: string;
      branches: Array<{
        order: number;                    // evaluation priority within the step
        matchCriteria: string;
        nextStepOrder: number | null;     // must equal another step's `order` in THIS payload
        outcome: "PASS" | "RETRY" | null; // exactly one of nextStepOrder/outcome is set
      }>;
    }>;
  }
  ```

  `steps: []` clears the scenario — the objective falls back to its flat
  `checkQuestion`/`gradingCriteria`. 404 if the objective doesn't exist in the caller's org. 400
  (`invalid_scenario`) if: any step has zero branches, a branch has both or neither of
  `nextStepOrder`/`outcome` set, a `nextStepOrder` doesn't match any step's `order` in the payload,
  or step/branch-within-step `order` values aren't unique. 200 with the saved steps (real ids,
  `nextStepOrder` resolved to `nextStepId`).

- `GET /v1/curricula/:curriculumId` (existing, `curriculum.ts`) — response's `objectiveSchema`
  gains `scenarioSteps: ScenarioStepResult[]` (empty array = no scenario), so the dashboard editor
  loads existing scenario state in the same request it already makes.

No changes to `PUT /v1/curricula/:id/objectives`, `.../progress`, or `.../effectiveness` —
`ObjectiveProgress` rows are identical either way; those endpoints don't need to know whether a
verdict came from `grade_answer` or a scenario's terminal branch.

---

## Database Changes

Two new tenant-scoped tables, `org_id` + RLS, mirroring the established
add-tables-then-RLS migration pair:

```prisma
/// Tenant-scoped. Optional, ordered branching step attached to an Objective. When an Objective
/// has zero ScenarioSteps it behaves exactly as interactive-assessment.md defined (flat
/// checkQuestion/gradingCriteria) — checkQuestion/gradingCriteria stay required and untouched
/// either way; this is additive, not a replacement of those fields.
model ScenarioStep {
  id          String   @id @default(uuid()) @db.Uuid
  orgId       String   @map("org_id") @db.Uuid
  objectiveId String   @map("objective_id") @db.Uuid
  order       Int
  prompt      String
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  organization     Organization     @relation(fields: [orgId], references: [id])
  objective        Objective        @relation(fields: [objectiveId], references: [id], onDelete: Cascade)
  branchesFromHere ScenarioBranch[] @relation("BranchFromStep")
  branchesToHere   ScenarioBranch[] @relation("BranchToStep")

  @@unique([objectiveId, order])
  @@index([orgId])
  @@index([objectiveId])
  @@map("scenario_steps")
}

/// Tenant-scoped. One branch out of a ScenarioStep. matchCriteria is judged the same way
/// Objective.gradingCriteria is — an LLM judge call, never the model self-reporting which branch
/// matched. Exactly one of (nextStepId, outcome) is set: nextStepId continues the scenario;
/// outcome (reusing ObjectiveProgressVerdict — no new parallel enum) terminates it and feeds
/// record_progress exactly like grade_answer's verdict does today.
model ScenarioBranch {
  id            String                    @id @default(uuid()) @db.Uuid
  orgId         String                    @map("org_id") @db.Uuid
  fromStepId    String                    @map("from_step_id") @db.Uuid
  order         Int
  matchCriteria String                    @map("match_criteria")
  nextStepId    String?                   @map("next_step_id") @db.Uuid
  outcome       ObjectiveProgressVerdict?
  createdAt     DateTime                  @default(now()) @map("created_at")

  organization Organization  @relation(fields: [orgId], references: [id])
  fromStep     ScenarioStep  @relation("BranchFromStep", fields: [fromStepId], references: [id], onDelete: Cascade)
  nextStep     ScenarioStep? @relation("BranchToStep", fields: [nextStepId], references: [id])

  @@unique([fromStepId, order])
  @@index([orgId])
  @@index([fromStepId])
  @@map("scenario_branches")
}
```

Additive relation fields: `Objective.scenarioSteps`, `Organization.scenarioSteps`/
`scenarioBranches`. `PUT .../scenario` always deletes and recreates a whole objective's step set
in one transaction (replace-the-whole-scenario semantics, same convention `replaceObjectives`
already uses for the objectives list) — so a branch never dangles pointing at a step being deleted
mid-edit; no `onDelete` behavior needed on the `nextStep` FK beyond the default.

---

## UI Changes

**Dashboard — Curriculum admin page.** `ObjectiveRow.tsx` gains a "Branching scenario" button per
*saved* objective (disabled with a "save this objective first" hint on a still-unsaved new row,
since the scenario endpoint needs a real `objectiveId`). Opens a new `ScenarioEditor.tsx`, saved
independently of the main objectives list via its own `PUT .../scenario` call — the same
"secondary sub-resource with its own independent save action" shape `ChecklistEditor.tsx` already
established for `Curriculum`'s checklist. Editor: a repeatable step list (prompt textarea per
step, add/remove/reorder same as `ObjectiveList`'s existing up/down/remove buttons), each step
with a repeatable branch list (`matchCriteria` input + a "leads to" select: other steps in this
scenario, or "End: PASS" / "End: RETRY").

```
No changes to Widget or Analytics. Session rehearsal screen (CheckpointFeedback.tsx) needs no
change either — a scenario's terminal verdict arrives as the same checkpoint.result message the
flat-question path already sends; the transcript panel doesn't need to know a scenario ran.
```

---

## Realtime Changes

**New 5th tool** (`packages/shared/src/curriculum/tools.ts`, added to `CURRICULUM_TOOLS`):

```ts
export const ADVANCE_SCENARIO_TOOL: LLMToolDefinition = {
  name: "advance_scenario",
  description:
    "Call this instead of grade_answer, immediately after the learner answers a scenario step's prompt for an objective whose curriculum context shows a scenario opening line instead of a check question.",
  parameters: {
    type: "object",
    properties: { objectiveId: { type: "string", description: "The id of the objective whose scenario step the learner just answered." } },
    required: ["objectiveId"],
  },
};
```

**`SessionCurriculumObjective`** (`apps/api/src/services/curriculum-service.ts`) gains
`scenarioSteps: SessionScenarioStep[]` (`{ id, prompt, branches: { matchCriteria, nextStepId,
outcome }[] }[]`, default `[]`) — loaded once in `getCurriculumForAvatar` alongside the objectives
query (one extra `findMany` with a nested `include`, same "load once at session.start, cache for
the connection's life" pattern the rest of `SessionCurriculum` already uses) so the hot per-turn
tool-dispatch path never queries the DB for step/branch text, per `CLAUDE.md`'s "no expensive work
inside realtime event handlers."

**Tool dispatch (`conversation-service.ts`)**:
- New session-scoped `const activeScenarioState = new Map<string, { currentStepId: string; hops:
  number }>()`, declared alongside `curriculum` (not inside `processTurn`) — this is deliberate:
  the existing code comment at `runTool`'s definition already establishes that `start_checkpoint`
  and `grade_answer` "are necessarily different turns in a real spoken conversation"; a branching
  scenario is the same shape, just more than two turns. `gradedThisTurn` stays turn-scoped and
  unchanged.
- `start_checkpoint` — unchanged for flat objectives. When `objective.scenarioSteps.length > 0`:
  additionally sets `activeScenarioState.set(objectiveId, { currentStepId: firstStep.id, hops: 0
  })` and returns `` `ok: checkpoint started, now present this: ${firstStep.prompt}` `` as the tool
  result (the model gets the opening line from the tool result rather than a static system-prompt
  check question, since only the FIRST step is knowable upfront).
- `grade_answer` — gains one guard: if the objective has `scenarioSteps.length > 0`, return
  `"error: this objective uses a branching scenario — call advance_scenario instead"` rather than
  grading against the (unused, for scenario objectives) flat `gradingCriteria`. Keeps the two paths
  mutually exclusive.
- New `advance_scenario` case: requires an `activeScenarioState` entry for `objectiveId` (else
  `"error: call start_checkpoint for this objective before advancing its scenario"`, same
  defensive style `record_progress` already uses); re-derives the answer from `text` — this turn's
  already-resolved user text, never a model-supplied argument, matching
  `.claude/rules/tenancy.md`'s "server re-checks" rule `grade_answer` already follows. Runs a new
  `classifyScenarioAnswerWithJudge(step, branches, text, signal)` — a small separate `llm.chat()`
  call, same provider-factory/timeout pattern as `gradeAnswerWithJudge`, prompt lists each branch's
  `matchCriteria` by letter and asks for `BRANCH: <letter>` + one feedback line (same "exactly two
  lines" parsing convention). Then:
  - Chosen branch has `nextStepId` → increments `hops`; if `hops > MAX_SCENARIO_HOPS` (new
    constant `= 8`, mirroring `MAX_TOOL_ROUNDTRIPS`'s "pathological loop" guard but bounding
    *turns-per-checkpoint* rather than tool-calls-per-turn), force-resolve as a terminal `RETRY`
    with generic feedback instead of continuing indefinitely. Otherwise: advances
    `activeScenarioState`'s `currentStepId`, sends `scenario.step` eagerly (before the tool result
    even returns to the model — same pattern `start_checkpoint`'s `checkpoint.started` already
    uses for UI responsiveness), and the tool result carries the next step's `prompt`.
  - Chosen branch has `outcome` set (terminal) → `gradedThisTurn.set(objectiveId, { verdict:
    branch.outcome, feedback })` — **the exact same map `grade_answer` already writes to**, so
    `record_progress` needs zero changes; it only ever reads from `gradedThisTurn`, indifferent to
    which tool populated it. Clears `activeScenarioState` for this `objectiveId`. Tool result text
    mirrors `grade_answer`'s `` `verdict: ...; feedback: ...` `` shape.
- **Known, documented limitation, not solved here**: `activeScenarioState` is in-memory only, like
  `curriculum` itself — a reconnect mid-scenario restarts that objective's scenario from step one
  next time `start_checkpoint` fires. Same class of gap `.claude/specs/video-chat-session.md`'s
  deferred session persistence already leaves open elsewhere in this codebase.

**New WS server message** (`packages/shared/src/realtime/ws-messages.ts`), added to
`serverMessageSchema`'s discriminated union:

```ts
export const scenarioStepMessageSchema = z.object({
  type: z.literal("scenario.step"),
  objectiveId: z.string(),
  stepId: z.string(),
  prompt: z.string(),
});
```

**`appendCurriculumContext`** (`packages/shared/src/tutor/system-prompt.ts`) —
`CurriculumContextObjective` gains an optional `firstScenarioStepPrompt?: string` (only the first
step is deterministic; later ones are branch-dependent and surface only via `advance_scenario`'s
tool result at runtime). When present, the per-objective block shows that line instead of "Check
question: ..."; the trailing tool-use instructions gain one line: objectives shown with a scenario
opening line use `advance_scenario` after each answer instead of `grade_answer` — it returns
either the next line to present or a final verdict to record exactly like `grade_answer`'s.

**Latency.** This diffs `conversation-service.ts` → `.claude/rules/realtime.md` requires `pnpm
bench:latency` output and a `latency-auditor` review before the PR. The new judge call only ever
fires inside `advance_scenario`, itself only ever called for scenario-tagged objectives
(avatar-decided) — an ordinary turn, and even an ordinary checkpoint on a non-scenario objective,
is unaffected. Bounded by the same existing `TOOL_TIMEOUT_MS` (3s) per-tool timeout; on timeout the
model is told the tool failed and continues, same as every other tool today.

---

## Files to Modify

- `prisma/schema.prisma` — `ScenarioStep`, `ScenarioBranch`, `Objective.scenarioSteps`,
  `Organization` relation fields
- `packages/shared/src/curriculum/schema.ts` — scenario request/result schemas,
  `objectiveSchema` extended
- `packages/shared/src/curriculum/tools.ts` — `ADVANCE_SCENARIO_TOOL`, `CURRICULUM_TOOLS`
- `packages/shared/src/realtime/ws-messages.ts` — `scenarioStepMessageSchema`
- `packages/shared/src/tutor/system-prompt.ts` — `CurriculumContextObjective`,
  `appendCurriculumContext`, their `.test.ts`
- `apps/api/src/services/curriculum-service.ts` — `SessionCurriculumObjective`/
  `SessionCurriculum`, `getCurriculumForAvatar`, `toObjectiveResult`, `curriculum-service.test.ts`
- `apps/api/src/services/conversation-service.ts` — `activeScenarioState`, `runTool`'s
  `start_checkpoint`/`grade_answer`/new `advance_scenario` cases, `MAX_SCENARIO_HOPS`,
  `conversation-service.test.ts`
- `apps/api/src/app.ts` — register `scenario.ts` routes
- `apps/dashboard/lib/api-client.ts` — `replaceObjectiveScenario` wrapper,
  `getCurriculum`'s response type picks up `scenarioSteps` automatically
- `apps/dashboard/app/(dashboard)/curriculum/ObjectiveRow.tsx`, `ObjectiveRow.test.tsx`,
  `CurriculumEditor.tsx`, `page.module.css`

## Files to Create

- `prisma/migrations/<ts>_add_branching_scenarios/migration.sql`
- `prisma/migrations/<ts>_branching_scenarios_rls/migration.sql`
- `apps/api/src/services/scenario-service.ts`, `scenario-service.test.ts` — validation + the
  replace-whole-scenario transaction
- `apps/api/src/routes/scenario.ts`, `scenario.test.ts`
- `apps/dashboard/app/(dashboard)/curriculum/ScenarioEditor.tsx`, `ScenarioEditor.test.tsx`

---

## Dependencies

```
No new dependencies. The branch-classification judge call reuses the existing LLMProvider
factory/adapters — same "small separate llm.chat() call" pattern gradeAnswerWithJudge already
uses, just with an N-way instead of binary prompt.
```

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Maintain tenant isolation using `org_id`; new route needs a two-org isolation test
- `advance_scenario`'s classification, like `grade_answer`'s verdict, is always server-computed
  from the turn's own resolved text — never a model-supplied argument
  (`.claude/rules/tenancy.md`)
- `pnpm bench:latency` + `latency-auditor` review required before this PR
  (`.claude/rules/realtime.md`) — any `conversation-service.ts` diff needs it
- Validate the new route's request/response with Zod
- Use strict TypeScript, no `any`
- Prefer modifying existing code — reuse `gradedThisTurn`/`record_progress` unchanged rather than
  building a parallel scenario-progress persistence path
- Run `pnpm verify`

---

## Testing

- **Unit** — `classifyScenarioAnswerWithJudge` prompt construction and letter-parsing (mirroring
  `gradeAnswerWithJudge`'s existing test style), `runTool`'s `advance_scenario` cases (continues to
  next step, resolves terminal PASS/RETRY into `gradedThisTurn`, rejects when no
  `activeScenarioState` entry exists, `grade_answer` rejects a scenario-tagged objective), the
  `MAX_SCENARIO_HOPS` force-resolve case (a pathological branch graph that only ever routes back to
  itself), `scenario-service.ts`'s validation (dangling `nextStepOrder`, both/neither of
  `nextStepOrder`/`outcome` set, duplicate `order`s, `steps: []` clearing an existing scenario).
- **Integration** — `PUT /v1/objectives/:objectiveId/scenario` route tests (OWNER-gated, every 400
  validation case, 404 cross-org), a WS conversation test driving `start_checkpoint` →
  `advance_scenario` (non-terminal) → `scenario.step` → `advance_scenario` (terminal) →
  `checkpoint.result` against a fake `LLMProvider` emitting scripted tool calls, mirroring
  `conversation-service.test.ts`'s existing fake-provider pattern.
- **Two-org isolation test** — org A cannot write/read against org B's objective's scenario.
- **Realtime** — `pnpm bench:latency` before/after; confirm a turn with no `advance_scenario` call,
  and a checkpoint on a non-scenario objective, are both unaffected.
- **End-to-End** — manual: author a 2-step branching scenario (step 1 with a "good" branch → step 2
  and a "poor" branch → terminal RETRY; step 2 terminates PASS or RETRY) for one objective, run a
  rehearsal session, answer to route down each branch at least once, confirm step 2's prompt is
  presented after a continuing branch, confirm a terminal verdict records progress identically to
  the flat-question path, confirm the hop limit forces resolution on an intentionally looping
  branch graph.
- **Manual Verification** — cross-tenant: org A's dashboard cannot edit or view org B's objective
  scenarios even with a guessed `objectiveId`.

---

## Definition of Done

- Feature works end-to-end (author a branching scenario → teach → multi-step checkpoint →
  branch → terminal grade → record → complete)
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained (`pnpm bench:latency`, `latency-auditor` reviewed)
- No security regressions (`advance_scenario`'s classification remains server-computed; RLS on
  both new tables; two-org isolation test passes)
