# Spec: Training Effectiveness Measurement

## Overview

Turns the existing per-objective `ObjectiveProgress` data (`.claude/specs/interactive-assessment.md`)
from a raw pass/retry table into an aggregate effectiveness view. Today
`GET /v1/curricula/:curriculumId/progress` returns one row per `(objective, learner)` — verdict,
attempts, feedback — and the dashboard's `ProgressTable.tsx` renders it as-is: a trainer can see
that Learner X retried Objective 2 three times, but not how many learners have finished the
curriculum, which objective is the hardest, or how long mastery takes on average. This spec adds
one new read-only aggregation — completion rate, per-objective mastery (pass rate in curriculum
order), and time-to-competency — computed from data the product already collects. No new tables,
no new columns, no conversation-service/realtime changes.

---

## Business Goal

`docs/ROADMAP.md` Phase 5 names this directly: "analytics (completion, mastery, drop-off points,
transcript search)". This spec builds the completion and mastery portion. Drop-off points (which
would require session-level abandonment events — no such table exists; `video-chat-session.md`'s
session persistence was deliberately deferred) and transcript search (depends on
`knowledge-management.md`'s pgvector infra, an unrelated concern) are explicitly not built here —
see Scope decisions. Without this, a trainer authoring a curriculum has no way to answer "is this
training actually working" beyond scrolling a per-attempt table by hand — the exact gap
`interactive-assessment.md` left open and `training-catalog.md` anticipated ("no field for a
future analytics view to break completion down by audience").

---

## Depends On

- `.claude/specs/interactive-assessment.md` (owns `ObjectiveProgress`/`Objective`/`Curriculum` and
  the existing `GET /v1/curricula/:curriculumId/progress` endpoint/`ProgressTable.tsx` this spec
  sits alongside)
- `.claude/specs/partner-role.md` (the `readGate`/`assertVisibleTo` visibility rules this spec's
  endpoint reuses unchanged)

---

## Components Affected

- `apps/api` — new effectiveness endpoint + service function
- `apps/dashboard` — new summary view in the existing Curriculum admin page
- `packages/shared` — new Zod contracts for the effectiveness response

---

## API Changes

- `GET /v1/curricula/:curriculumId/effectiveness` — new. Same gate as the existing progress
  endpoint: `readGate` (`requireAnyRole(["OWNER", "PARTNER"])`), then `assertVisibleTo(role,
  curriculum)` (404, never 403, on a PARTNER requesting a non-`PARTNER_ENABLEMENT` curriculum —
  exact precedent as `listCurriculumProgress`). 404 if the curriculum doesn't exist. 200:

  ```ts
  {
    curriculumId: string;
    learnerCount: number;           // distinct learners with >=1 ObjectiveProgress row here
    completedLearnerCount: number;  // learners with a PASS row on every objective
    completionRate: number;         // completedLearnerCount / learnerCount; 0 if learnerCount is 0
    avgTimeToCompetencySeconds: number | null; // avg(updatedAt - createdAt) over all PASS rows; null if none
    objectives: Array<{
      objectiveId: string;
      objectiveTitle: string;
      order: number;
      attemptedLearnerCount: number;
      passedLearnerCount: number;
      passRate: number;             // passedLearnerCount / attemptedLearnerCount; 0 if none attempted
      avgAttemptsToPass: number | null;          // avg(attempts) over this objective's PASS rows
      avgTimeToCompetencySeconds: number | null; // avg(updatedAt - createdAt) over this objective's PASS rows
    }>; // ordered by Objective.order — this ordering is what makes it a "mastery trend": pass
        // rate read down the array shows where learners stall as they progress through the
        // curriculum, without needing a new time-series/event table.
  }
  ```

No changes to any existing endpoint or response shape.

---

## Database Changes

No database changes. `ObjectiveProgress.createdAt` (set once, first attempt) and `.updatedAt`
(bumped on every upsert; for a row currently `verdict: PASS`, this is the timestamp of the update
that produced that pass) are already sufficient to derive time-to-competency — no new column, no
migration. All aggregation is a read over existing, already-RLS'd tables
(`20260812093400_interactive_assessment_rls`).

Known limitation, not solved here (no new schema for it): if an objective is re-triggered and
re-graded after already having been passed once, `updatedAt` moves to the newer pass and
`avgTimeToCompetencySeconds` reflects time-to-*most-recent*-pass, not time-to-*first*-pass. A full
attempt history would fix this but was already deliberately deferred by
`interactive-assessment.md` ("One `ObjectiveProgress` row per (objective, learner), not a full
attempt log") — not reopened here.

---

## UI Changes

**Dashboard — Curriculum admin page** (`apps/dashboard/app/(dashboard)/curriculum/`). New
`EffectivenessSummary.tsx`, purely presentational (same convention as `ProgressTable.tsx`),
rendered in `CurriculumEditor.tsx` directly above the existing `ProgressTable` — a small stat row
(completion rate, learner count, curriculum-wide avg time-to-competency) followed by a per-objective
bar/row list in `order` sequence showing each objective's pass rate, so a trainer can see which
objective in the sequence is where learners stall. Fetched alongside the existing
`listCurriculumProgress` call in `CurriculumEditor.tsx`'s `Promise.all` (same loading-state
lifecycle, one extra request). No polling — same on-demand-only convention the existing progress
view uses.

```
No changes to Widget, Avatar, or the session rehearsal screen — this is a trainer-facing
dashboard report, not something the avatar or learner sees.
```

---

## Realtime Changes

No realtime changes. This endpoint is not on the `conversation-service.ts` tool-call path — it is
a plain dashboard `GET` computed from already-persisted rows, so `.claude/rules/realtime.md` and
its `pnpm bench:latency`/`latency-auditor` requirement do not apply.

---

## Files to Modify

- `apps/api/src/routes/curriculum.ts` — new `GET /v1/curricula/:curriculumId/effectiveness` route
  under the existing `readGate`
- `apps/api/src/services/curriculum-service.ts` — new `getCurriculumEffectiveness(orgId,
  curriculumId, role)`, reusing `assertVisibleTo` and the `withOrg` wrapper exactly as
  `listCurriculumProgress` does
- `apps/api/src/routes/curriculum.test.ts`, `apps/api/src/services/curriculum-service.test.ts`
- `packages/shared/src/curriculum/schema.ts` — new `objectiveEffectivenessSchema`,
  `curriculumEffectivenessSchema`, response type (auto-exported; `curriculum/index.ts` already does
  `export * from "./schema.js"`, no barrel edit needed)
- `apps/dashboard/lib/api-client.ts` — new `getCurriculumEffectiveness(curriculumId)` wrapper,
  same shape as the existing `listCurriculumProgress` wrapper
- `apps/dashboard/app/(dashboard)/curriculum/CurriculumEditor.tsx`,
  `CurriculumEditor.test.tsx` — fetch + render the new summary

## Files to Create

- `apps/dashboard/app/(dashboard)/curriculum/EffectivenessSummary.tsx`,
  `EffectivenessSummary.test.tsx`

---

## Dependencies

```
No new dependencies. Aggregation is computed in JS over Prisma query results, matching the
existing pattern in curriculum-service.ts (no service in this codebase uses Prisma groupBy or raw
SQL for aggregation today).
```

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Maintain tenant isolation using `org_id` — every query through `withOrg`
- `assertVisibleTo(role, curriculum)` reused unchanged for PARTNER visibility (404, not 403/empty,
  on a hidden curriculum — no existence-probing)
- Validate the new response with a Zod schema in `packages/shared`
- Use strict TypeScript, no `any`
- Prefer modifying existing code — extend `curriculum-service.ts`/`curriculum.ts`, do not create a
  parallel "analytics service"
- Run `pnpm verify`
- New endpoint needs a two-org isolation test asserting cross-tenant reads return zero rows
  (`.claude/rules/tenancy.md`)
- Guard every division (completion rate, pass rate, avg-attempts, avg-time-to-competency) against a
  zero-denominator — return `0`/`null`, never `NaN`

---

## Testing

- **Unit** (`curriculum-service.test.ts`) — `getCurriculumEffectiveness`: zero-progress curriculum
  (all zeros/nulls, no `NaN`), all-learners-passed (completionRate `1`), mixed pass/retry, a
  learner who retried an objective multiple times before passing (attempts counted correctly in
  `avgAttemptsToPass`), objectives returned in `order` sequence, PARTNER role hitting a
  non-`PARTNER_ENABLEMENT` curriculum gets `notFound`.
- **Integration** (`curriculum.test.ts`) — `GET .../effectiveness`: 200 shape for OWNER and
  PARTNER (visible curriculum), 404 for missing curriculum, 404 for PARTNER on a hidden curriculum,
  401 unauthenticated.
- **Two-org isolation test** — org A's request against org B's `curriculumId` returns 404, org A's
  aggregate never includes org B's `ObjectiveProgress` rows.
- **End-to-End** — manual: run a rehearsal session, pass one objective and RETRY-then-pass another,
  confirm the dashboard's new summary shows correct completion rate, per-objective pass rate, and a
  non-null time-to-competency for both passed objectives.
- **Realtime** — none required; not on the audio/tool-call path.
- **Manual Verification** — cross-tenant: org A's dashboard cannot see org B's effectiveness data
  even with a guessed `curriculumId`.

---

## Definition of Done

- Feature works end-to-end (dashboard shows completion rate, per-objective mastery trend, and
  time-to-competency computed from real `ObjectiveProgress` data)
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- No security regressions (RLS/`withOrg` on the new query, `assertVisibleTo` reused, two-org
  isolation test passes)
