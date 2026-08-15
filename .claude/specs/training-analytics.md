# Spec: Training Analytics

## Overview

Adds an org-wide *learning outcomes* rollup to the trainer dashboard's `/analytics` page,
alongside the existing usage view: participation (distinct learners active, curricula attempted),
an org-wide effectiveness summary (avg. completion rate, avg. time-to-competency across every
curriculum), and knowledge-gap identification (the objectives with the lowest pass rates
org-wide, so an OWNER can see *what* people are failing, not just *whether* they finished).

`.claude/specs/training-effectiveness-measurement.md` already aggregates `ObjectiveProgress` into
a *per-curriculum* view (`GET /v1/curricula/:id/effectiveness` → completion rate, mastery trend,
time-to-competency) rendered by `EffectivenessSummary.tsx` on one curriculum's admin page. That
view has no org-wide rollup and no cross-curriculum ranking — a trainer with 12 curricula has no
single place to see "which objective, anywhere in my org, is the biggest problem." This spec is
that rollup: same source table, same aggregation style, new grouping (across curricula, not
within one). It does not touch that spec's endpoint, table, or per-curriculum UI.

`.claude/specs/dashboard-analytics.md` already ships the sibling *usage/engagement* half of
`docs/ROADMAP.md` Phase 5's analytics line (active users, total conversations, session duration,
most-accessed knowledge areas) on the same `/analytics` page. This spec is the *learning
outcomes* half — completion, participation, effectiveness, knowledge gaps — Phase 5's other
listed items (`completion, mastery, drop-off points, transcript search`) minus transcript search
(out of scope: full-text search over `Message` content is a different feature with its own
indexing/UI concerns, not an aggregate stat). It extends the same page rather than adding a new
nav entry.

**Scope-defining finding, not obvious from either spec above:** `ObjectiveProgress` — the *only*
table this spec or `training-effectiveness-measurement.md` can aggregate — has the identical
rehearsal-only limitation `dashboard-analytics.md` found in `TrainingSession`, for the identical
root cause. `conversation-service.ts`'s `record_progress`/`grade_answer` handlers guard
`if (!claims.userId)` before writing (`claims.userId` is only set for an authenticated dashboard
session — see `.claude/rules/tenancy.md`: "Unsigned (anonymous) identity may never write to
`ObjectiveProgress`"). The public `apps/widget` embed authenticates anonymously
(`POST /v1/embed/ticket`, no `userId` in its claims), so it can never produce an
`ObjectiveProgress` row. Every completion rate, mastery trend, and time-to-competency number in
this product today — and every number this spec adds — is computed from OWNER/MEMBER/PARTNER
accounts rehearsing in the dashboard, not real end-learners on a customer's site.
`training-effectiveness-measurement.md` shipped without surfacing this; this spec does not repeat
that omission. Real end-learner training-effectiveness analytics needs the same
"anonymized, non-identity-linked telemetry" redesign `dashboard-analytics.md` already deferred to
a follow-up spec for usage — building it here would duplicate that deferral and still can't solve
it alone (a completion *rate* needs an identity to dedupe against, which anonymous-by-design
telemetry deliberately doesn't have). So: everything below is labeled "dashboard rehearsal" in
the UI, exactly like `UsageAnalyticsSummary.tsx` already labels its three `TrainingSession`
fields — consistent honesty, not a new problem.

---

## Business Goal

The session status going into this feature: "Built: nothing counts as real analytics. Per-turn
latency is logged to the console (not persisted), and a raw, unaggregated per-objective progress
table is the only genuine data point in the system. What's left — essentially the whole section:
No training analytics: completion rates, participation, knowledge-gap identification,
learning-effectiveness metrics." Per-curriculum completion/mastery/time-to-competency already
shipped since that status was written (`training-effectiveness-measurement.md`), but only as a
per-curriculum drill-down — an OWNER still cannot answer "org-wide, are people actually learning,
and where are they stuck" without opening every curriculum one at a time. This spec closes that:
one rollup, plus a ranked knowledge-gap list, built entirely from `ObjectiveProgress` the product
already writes — no speculative new subsystems, no new table.

---

## Depends On

- `.claude/specs/interactive-assessment.md` (owns `ObjectiveProgress`, the sole data source)
- `.claude/specs/training-effectiveness-measurement.md` (owns the per-curriculum aggregation this
  spec rolls up further; reuses its `average()`/time-to-competency conventions)
- `.claude/specs/dashboard-analytics.md` (owns the `/analytics` page and its OWNER-only gate,
  window-switcher UI pattern, and rehearsal-only labeling convention, all reused here)

---

## Components Affected

- `apps/api` — new service function + route on the existing analytics endpoint group
- `apps/dashboard` — new section on the existing `/analytics` page, no new route/nav entry
- `packages/shared` — new Zod contracts alongside the existing usage-analytics ones

---

## API Changes

- `GET /v1/analytics/training` — new, added to the existing `apps/api/src/routes/analytics.ts`
  (not a new route file — same two domains-neither-owns-it reasoning that file already exists
  for, and this reads the same `ObjectiveProgress`/`Objective`/`Curriculum` tables
  `curriculum.ts` owns, plus `User` for participant counting). Gate: `requireRole("OWNER")`, same
  as `GET /v1/analytics/usage` — org-wide, cross-curriculum numbers are strictly more sensitive
  than one `readGate`-visible curriculum's own effectiveness, so PARTNER stays excluded.

  No query parameters, no time window — same reasoning
  `training-effectiveness-measurement.md` already relies on: `ObjectiveProgress` is bounded by
  `(org's objective count) × (org's rehearsing-staff count)`, not open-ended event volume, so
  there's no unbounded-scan risk to guard against with a `days` param. Windowing here would also
  make this endpoint's numbers silently diverge from the per-curriculum effectiveness numbers a
  trainer just looked at on the same curriculum's page, for no safety benefit.

  200:

  ```ts
  {
    generatedAt: string; // ISO timestamp
    participantCount: number; // distinct learners with >=1 ObjectiveProgress row, org-wide
    curriculumsWithActivityCount: number; // distinct curricula with >=1 ObjectiveProgress row
    avgCompletionRate: number | null; // mean of per-curriculum completionRate, curricula with activity only
    avgTimeToCompetencySeconds: number | null; // mean across every PASS row org-wide
    knowledgeGaps: Array<{
      objectiveId: string;
      objectiveTitle: string;
      curriculumId: string;
      curriculumTitle: string;
      attemptedLearnerCount: number;
      passRate: number; // 0..1
    }>; // objectives with attemptedLearnerCount >= MIN_ATTEMPTS (2), sorted by passRate asc, capped at 10
  }
  ```

  `MIN_ATTEMPTS = 2` (module constant, mirrors `TOP_KNOWLEDGE_AREAS_LIMIT`'s style in
  `analytics-service.ts`): a single learner's single attempt is a data point, not a "gap" —
  ranking on `passRate` alone would let a curriculum authored by one trainer testing it once and
  failing show up above objectives 20 learners actually struggled with.

---

## Database Changes

No database changes. Reuses `ObjectiveProgress` (`.claude/specs/interactive-assessment.md`),
`Objective`/`Curriculum` (for titles), and `User` (for the participant count) exactly as they
exist today — same table `training-effectiveness-measurement.md` already reads, grouped
differently.

---

## UI Changes

- **Dashboard** — `apps/dashboard/app/(dashboard)/analytics/page.tsx` gains a second section,
  `TrainingAnalyticsSummary`, rendered below the existing `UsageAnalyticsSummary`. No new nav
  item, no new route: `Sidebar.tsx`'s existing OWNER-only "Analytics" entry
  (`.claude/specs/dashboard-analytics.md`) already points at this page. Page subtitle copy
  extended to disclose the same rehearsal-only caveat for the new section, matching the existing
  sentence's tone ("...reflect dashboard rehearsal activity... not learners on your embedded
  widget").
- No changes to Widget, Avatar, or Admin surfaces — this is a trainer-facing dashboard view, same
  boundary `training-effectiveness-measurement.md` drew.

---

## Realtime Changes

No realtime changes. This reads `ObjectiveProgress` after the fact; it does not touch
`conversation-service.ts`, the realtime event handlers, or the audio path.

---

## Files to Modify

- `apps/api/src/routes/analytics.ts` — add `GET /v1/analytics/training` under the same `gate`
- `apps/api/src/services/analytics-service.ts` — add `getTrainingAnalytics`, reusing its existing
  `average()` helper
- `packages/shared/src/analytics/schema.ts` — add `trainingAnalyticsResponseSchema` +
  `knowledgeGapSchema`, exported via the existing `packages/shared/src/analytics/index.ts`
- `apps/dashboard/lib/api-client.ts` — add `getTrainingAnalytics()`, same shape as
  `getUsageAnalytics()`
- `apps/dashboard/app/(dashboard)/analytics/page.tsx` — render `TrainingAnalyticsSummary`, extend
  subtitle copy
- `apps/dashboard/app/(dashboard)/analytics/page.module.css` — add styles only if the existing
  `statRow`/`stat`/`knowledgeTable`/`sectionLabel`/`empty` classes (already shared by
  `UsageAnalyticsSummary.tsx` and `EffectivenessSummary.tsx`) don't cover the knowledge-gap table;
  reuse them as-is where they do

---

## Files to Create

- `apps/dashboard/app/(dashboard)/analytics/TrainingAnalyticsSummary.tsx` — same fetch/render
  shape as `UsageAnalyticsSummary.tsx`, no window switcher (endpoint is unwindowed)
- `apps/dashboard/app/(dashboard)/analytics/TrainingAnalyticsSummary.test.tsx`
- `apps/api/src/services/analytics-service.test.ts` — extend (existing file) with
  `getTrainingAnalytics` cases, including the two-org isolation test `.claude/rules/tenancy.md`
  requires for any new query
- `apps/api/src/routes/analytics.test.ts` — extend (existing file) with the new route's
  OWNER-gate and PARTNER-rejection cases

---

## Dependencies

No new dependencies.

---

## Implementation Rules

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY`
- Maintain tenant isolation using `org_id` — every new query goes through `withOrg`
- Keep provider-specific logic inside adapters
- Validate the new endpoint's response with Zod (`trainingAnalyticsResponseSchema`)
- Preserve the public embed SDK contract (unaffected — this is dashboard-only)
- Keep realtime latency low (unaffected — no realtime path touched)
- Use strict TypeScript, never `any`
- Prefer modifying existing code — extend `analytics.ts`/`analytics-service.ts`/`page.tsx`,
  don't fork new parallel files for what's already there
- Run `pnpm verify`
- Label every rehearsal-derived number honestly in the UI — do not let "training analytics"
  silently read as "real customer-learner analytics"

---

## Testing

- **Unit Tests** — `analytics-service.test.ts`: `getTrainingAnalytics` with zero activity (all
  nulls/zeros, not a crash), with activity across multiple curricula (`avgCompletionRate` is the
  mean of *curricula with activity only* — a curriculum nobody has touched must not drag the
  average toward 0), `MIN_ATTEMPTS` filtering (an objective with 1 attempted learner never
  appears in `knowledgeGaps` even at `passRate: 0`), `knowledgeGaps` ordering and the 10-item cap.
- **Integration Tests** — `analytics.test.ts`: `GET /v1/analytics/training` OWNER-gate (200),
  PARTNER/MEMBER rejection (403), unauthenticated rejection (401); two-org isolation test
  asserting org B's `ObjectiveProgress` rows never appear in org A's `participantCount` or
  `knowledgeGaps` (`.claude/rules/tenancy.md` requirement for any new endpoint).
- **End-to-End** — manual: as OWNER, rehearse two curricula, fail one objective twice with two
  different dashboard accounts, pass the rest; confirm `/analytics` shows the failed objective in
  Knowledge Gaps and `participantCount`/`curriculumsWithActivityCount` match.
- **Realtime Tests** — not applicable; no realtime path touched.
- **Latency Benchmarks** — not applicable; this is an on-demand dashboard read, not on the audio
  path.
- **Manual Verification** — confirm the rehearsal-only caveat text renders and reads clearly
  before/after this change on `/analytics`.

---

## Definition of Done

- Feature works end-to-end
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained
- No security regressions
