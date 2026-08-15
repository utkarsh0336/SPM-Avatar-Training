# Spec: AI Performance Analytics

## Overview

Adds a third, real-time-pipeline-performance section to the trainer dashboard's existing
`/analytics` page: per-turn latency (by hop — STT, retrieval, LLM first token, TTS first chunk,
total) and a grounded-reply rate, both persisted for the first time from data the realtime turn
pipeline already computes every turn and currently only logs to the console or sends once over the
WebSocket. It also adds a knowledge-utilization *trend* (a daily time series) alongside the
existing `topKnowledgeAreas` snapshot `dashboard-analytics.md` already ships.

**Scope-defining finding, not obvious from the roadmap text:** of the four items the outstanding
gap names — response accuracy, user satisfaction, conversation quality, knowledge-utilization
trends — only two have a genuine, already-computed data source in this codebase today:

- **Latency** (`packages/shared/src/tutor/latency-log.ts`'s `TurnLatencyBreakdown`) is computed for
  every turn by `createTurnLatencyTracker` and passed to `tracker.finish()` in
  `conversation-service.ts` (~line 882), but `logTurnLatency` only `console.log`'s it — `apps/api`
  runs `Fastify({logger:false})`, so, exactly as `dashboard-analytics.md`'s Overview already noted
  for this same file, that `console.log` is the *only* record, and it's ephemeral. This spec
  persists it.
- **"Response accuracy"** has no ground-truth judge anywhere in this codebase — no human rating, no
  LLM-as-judge pass on the avatar's own replies, no fact-check subsystem. Building one is a new,
  speculative subsystem this spec deliberately does not invent. What *does* already exist, computed
  every turn and then discarded: whether the reply was grounded in retrieved knowledge-base content
  (`sources.length > 0`, ~conversation-service.ts line 875) versus degraded to the "Priority-3"
  ungrounded-generation fallback (retrieval timeout/failure or no relevant chunks —
  `knowledge-management.md`'s Realtime Changes §8). This spec persists and aggregates *that* signal,
  named `groundedReplyRate` — explicitly **not** "accuracy": it measures whether an answer was
  tied to the org's uploaded material, not whether the answer was factually correct. The UI must
  not blur that distinction.
- **"Conversation quality"** has no existing metric under that name either. Latency and
  groundedness together are the closest honest proxy this codebase can produce today (slow or
  ungrounded replies are the concrete, measurable failure modes of a "low quality" conversation);
  this spec does not invent a separate composite "quality score."
- **Knowledge-utilization trends**: `dashboard-analytics.md`'s `KnowledgeAccessEvent` (createdAt
  indexed, `orgId + createdAt`) already captures every retrieval on *both* the embed and dashboard
  rehearsal paths — the one metric in this whole feature set that is genuinely real, org-wide
  production data, not rehearsal-only. Today it only powers a top-10 *snapshot*
  (`topKnowledgeAreas`); this spec adds the missing time dimension.
- **User satisfaction has no capture mechanism anywhere in this codebase** — no rating/thumbs
  widget in `apps/widget` or the dashboard rehearsal surfaces, no feedback table. Building it means
  new UI on the *public* embed widget (an SDK-contract-sensitive surface — "Never break the public
  embed SDK contract" per `CLAUDE.md`) plus a new anonymous-write-capable table and endpoint. That
  is a materially different, larger, and riskier piece of work than "persist a number the pipeline
  already computes." Consistent with this codebase's existing convention of explicitly deferring
  work that needs new instrumentation rather than fabricating a placeholder metric (see
  `dashboard-analytics.md`'s deferred "real embed-traffic analytics" and `training-analytics.md`'s
  deferred "transcript search"), **user satisfaction is out of scope for this spec** and is called
  out as a named follow-up, not silently dropped.

Unlike `dashboard-analytics.md`'s three `TrainingSession`-derived fields and every field in
`training-analytics.md`, the metrics this spec adds are **not** rehearsal-only: the turn pipeline
this data comes from (`conversation-service.ts`'s realtime handler) runs identically for the
dashboard's own rehearsal surfaces and for real end-learners on `apps/widget`'s public embed — the
same reason `topKnowledgeAreas` is already labeled real/org-wide today. This is the first section
on `/analytics` that can honestly claim to reflect production traffic, and the UI should say so.

---

## Business Goal

The session status going into this feature: "Built: nothing counts as real analytics. Per-turn
latency is logged to the console (not persisted), and a raw, unaggregated per-objective progress
table is the only genuine data point in the system. What's left — essentially the whole section: No
AI performance analytics: response accuracy, user satisfaction, conversation quality,
knowledge-utilization trends." An OWNER today has no way to answer "is the avatar responding
quickly, and is it actually grounding answers in our uploaded material, across real customer
traffic" — the console-only latency log requires SSH/log access nobody using this dashboard has.
This spec turns two numbers the pipeline already computes every turn into a persisted, aggregated,
OWNER-facing view, plus a trend view of a metric already added in 3.9.2 — no speculative new
subsystems, and no metric that isn't backed by something the product genuinely measures today.

---

## Depends On

- `.claude/specs/dashboard-analytics.md` (owns the `/analytics` page, its OWNER-only gate, the
  windowed day-range-control convention this spec's new section reuses, and `KnowledgeAccessEvent`,
  the source of `knowledgeUtilizationTrend`)
- `.claude/specs/training-analytics.md` (owns the precedent of stacking a new summary section
  underneath existing ones on the same page with no new nav entry)
- `.claude/specs/video-chat-session.md` (owns `TrainingSession`, the nullable FK this spec's new
  table reuses — same nullability convention as `KnowledgeAccessEvent`)
- `.claude/specs/knowledge-management.md` (defines the Priority-1/2/3 grounded-vs-ungrounded
  generation behavior `groundedReplyRate` measures)
- `packages/shared/src/tutor/latency-log.ts` (owns `TurnLatencyBreakdown`, the exact shape this
  spec persists — not modified, only read from)

---

## Components Affected

- `apps/api` — new persisted write in the realtime turn-completion path, new analytics query
  function, new route on the existing analytics endpoint group
- `apps/dashboard` — new section on the existing `/analytics` page
- `packages/shared` — new Zod contracts alongside the existing usage/training analytics ones
- Database — one new table (`TurnMetric`)

---

## API Changes

- `GET /v1/analytics/performance` — new, added to the existing `apps/api/src/routes/analytics.ts`
  under the same `gate` (`requireRole("OWNER")`) as `/v1/analytics/usage` and
  `/v1/analytics/training` — org-wide pipeline-performance numbers are exactly as sensitive.

  Query: `?days=7|30|90` (reuses `usageAnalyticsQuerySchema`'s exact shape — same bounded-range
  reasoning: `TurnMetric` volume is one row per real conversational turn, unbounded like
  `KnowledgeAccessEvent`, not bounded like `ObjectiveProgress`).

  200:

  ```ts
  {
    windowDays: 7 | 30 | 90;
    generatedAt: string;

    // Real, org-wide — every real conversational turn writes one TurnMetric row regardless of
    // surface (embed or dashboard rehearsal). See Overview.
    turnCount: number;
    avgLatencyMs: {
      stt: number | null;
      retrieval: number | null;
      llmFirstToken: number | null;
      ttsFirstChunk: number | null;
      total: number | null;
    };
    // Share of turns where the reply was grounded in retrieved knowledge-base content
    // (sources.length > 0) rather than the ungrounded Priority-3 fallback. NOT a factual-accuracy
    // judgment — see Overview and Implementation Rules.
    groundedReplyRate: number | null; // 0..1, null when turnCount === 0

    // Fixed 14-day window, independent of `days` above — see Database Changes for why.
    knowledgeUtilizationTrend: Array<{ date: string; accessCount: number }>; // oldest first
  }
  ```

  No changes to any existing endpoint or response shape.

---

## Database Changes

New table, additive only — no changes to any existing model's columns except two back-relation
arrays.

```prisma
/// Tenant-scoped. org_id + RLS policy required — see .claude/rules/tenancy.md. Written
/// fire-and-forget from conversation-service.ts right after tracker.finish() computes the turn's
/// TurnLatencyBreakdown — one row per real conversational turn, both dashboard-rehearsal and
/// anonymous apps/widget embed sessions (trainingSessionId null for the latter, same nullability
/// convention as KnowledgeAccessEvent.trainingSessionId). `grounded` mirrors the same
/// sources.length > 0 check that decides whether the transcript message includes `sources` — see
/// conversation-service.ts ~line 875. Owned by .claude/specs/ai-performance-analytics.md.
model TurnMetric {
  id                String   @id @default(uuid()) @db.Uuid
  orgId             String   @map("org_id") @db.Uuid
  trainingSessionId String?  @map("training_session_id") @db.Uuid
  turnId            String   @map("turn_id")

  sttMs             Int?     @map("stt_ms")
  retrievalMs       Int?     @map("retrieval_ms")
  llmFirstTokenMs   Int?     @map("llm_first_token_ms")
  ttsFirstChunkMs   Int?     @map("tts_first_chunk_ms")
  totalMs           Int      @map("total_ms")
  grounded          Boolean

  createdAt DateTime @default(now()) @map("created_at")

  organization    Organization     @relation(fields: [orgId], references: [id])
  trainingSession TrainingSession? @relation(fields: [trainingSessionId], references: [id], onDelete: SetNull)

  @@index([orgId, createdAt])
  @@map("turn_metrics")
}
```

Back-relation arrays added to `Organization` and `TrainingSession` (`turnMetrics TurnMetric[]`),
matching this schema's existing convention of declaring both sides of every relation. No FK to a
`documentId` — this table is per-turn, not per-knowledge-access; it does not duplicate or replace
`KnowledgeAccessEvent`.

Two migrations, matching the existing `..._add_x` / `..._x_rls` pairing convention:

1. `..._add_turn_metrics` — `CREATE TABLE turn_metrics` + the `(org_id, created_at)` index.
2. `..._turn_metrics_rls` — `ENABLE ROW LEVEL SECURITY` + the standard
   `app.current_org_id`-scoped policy, copied from the most recent RLS migration's template.

**Aggregation approach.** `avgLatencyMs` and `turnCount`/`groundedRate` use Prisma's native
`aggregate`/`groupBy` (`_avg`, `_count`) directly against the window — no full-row fetch, same
reasoning `dashboard-analytics.md` already established for `topKnowledgeAreas` (`TurnMetric` volume
is unbounded like `KnowledgeAccessEvent`, unlike `ObjectiveProgress`). `_avg` on a nullable int
column ignores nulls automatically, which is exactly the "some turns skip a hop (e.g. no retrieval
call made)" behavior wanted here — no manual null-filtering needed.

**Percentiles are deliberately out of scope for v1.** `avgLatencyMs` reports the mean, not p50/p95.
Prisma's `aggregate` has no percentile function, and computing one would require either raw SQL
(`percentile_cont`, a pattern that does not exist anywhere in this codebase today and needs its own
review to introduce) or fetching every row in the window into Node and sorting — the exact
"full-row fetch of unbounded volume" `dashboard-analytics.md`'s Aggregation-approach note already
warned against. Shipping the simple, native-Prisma mean first (matching this codebase's repeated
precedent — see `dashboard-analytics.md`'s and `training-analytics.md`'s own "ship the bounded
version first" framing) and deferring percentiles to a follow-up once real volume is known is the
same trade this spec's sibling specs already made elsewhere.

**`knowledgeUtilizationTrend` uses a fixed 14-day window (`TREND_DAYS` module constant),
independent of the `?days=` selector, and is computed as 14 separate indexed `count()` calls (one
per day, `where: { orgId, createdAt: { gte: dayStart, lt: dayEnd } }`), not a single query.**
Reasoning: a per-day time series is a `GROUP BY date_trunc('day', created_at)`, which Prisma's
`groupBy` cannot express without raw SQL — the same "no raw SQL as a new pattern in this codebase"
reasoning above applies. Fourteen bounded, indexed (`orgId, createdAt`) count queries is simple,
uses only existing Prisma capability, and stays small regardless of org size — a deliberate,
documented departure from `?days=` binding to keep this specific sub-query cheap and constant-cost,
matching the "ship the simple bounded version first" precedent. If a longer/selectable trend range
is wanted later, that's a follow-up once real query cost is measured, not a v1 guess.

---

## UI Changes

**Dashboard — `apps/dashboard/app/(dashboard)/analytics/page.tsx`** gains a third section,
`PerformanceAnalyticsSummary`, rendered below the existing `UsageAnalyticsSummary` and
`TrainingAnalyticsSummary`. No new nav item, no new route — reuses the existing OWNER-only
"Analytics" sidebar entry from `dashboard-analytics.md`. Page subtitle copy extended with one more
sentence disclosing (a) that this section, unlike the two above it, reflects real production
traffic across both the embedded widget and dashboard rehearsal, and (b) that "grounded-reply rate"
measures whether replies cite the org's uploaded material, not factual correctness, and that
user-satisfaction and true response-accuracy metrics are not yet available (named, not silently
omitted).

**New `PerformanceAnalyticsSummary.tsx`** (`apps/dashboard/app/(dashboard)/analytics/`) — same
self-contained fetch/render shape as `UsageAnalyticsSummary.tsx`, including its own 7/30/90
day-range control (reuses the same pattern, a separate control from
`UsageAnalyticsSummary`'s — the two endpoints are independent reads, matching how neither existing
section shares fetch state today). Renders: a stat row (turn count, avg total latency ms, avg
latency by hop, grounded-reply rate as a percentage) followed by a small day-by-day
`knowledgeUtilizationTrend` list/sparkline-style row (14 fixed days, no control — reuses the
existing `statRow`/`stat`/`sectionLabel`/`empty` CSS classes already shared by the other two
summaries; a new class only if none of those fit the trend row).

```
No changes to Widget, Avatar, or the session rehearsal screen.
```

---

## Realtime Changes

One addition to the turn-completion path in `conversation-service.ts`, right after
`tracker.finish(...)` is called (~line 882, where `latency` is already computed and the `latency`
WS message is already sent) — this is *after* the turn's audio/transcript work is fully done, the
identical timing `recordKnowledgeAccess` already uses after retrieval, not a new step inserted into
the hot path itself. For each finished turn, fire `recordTurnMetric(claims.orgId, trainingSessionId,
{ turnId: latency.turnId, sttMs: latency.sttMs, retrievalMs: latency.retrievalMs,
llmFirstTokenMs: latency.llmFirstTokenMs, ttsFirstChunkMs: latency.ttsFirstChunkMs,
totalMs: latency.totalMs, grounded: sources.length > 0 })` **without awaiting it**, `.catch()`-ing
internally so a DB hiccup never surfaces as a turn failure — exactly `recordKnowledgeAccess`'s
existing pattern. New injectable `ConversationHandlerDeps.recordTurnMetric` dep, defaulting to the
real `analytics-service.js` export, matching `recordKnowledgeAccess`'s own dep-injection shape for
testability. Like `recordKnowledgeAccess` and unlike `persistTrainingSessionMessage`, this write
does **not** no-op when `trainingSessionId` is null — an anonymous embed turn's latency and
groundedness is exactly the real signal this table exists to capture.

No changes to OpenAI Realtime event names, WebRTC, LiveKit, the audio pipeline, sentence chunking,
or barge-in handling — this is a write appended after a turn has already fully completed and sent
its `latency`/`turn.ended` messages, not a new step in the turn itself. This is exactly the class of
diff `latency-auditor` exists to catch; **run it on the `conversation-service.ts` change before this
spec is considered done**, same as `dashboard-analytics.md` required for its own retrieval-path
write.

---

## Files to Modify

- `prisma/schema.prisma` — new `TurnMetric` model, back-relation arrays on `Organization` and
  `TrainingSession`
- `apps/api/src/services/conversation-service.ts` — new injectable `recordTurnMetric` dep;
  fire-and-forget call right after `tracker.finish()`
- `apps/api/src/services/conversation-service.test.ts` — new tests for the write (fires for both a
  rehearsal session and an embed session, never awaited/blocks the turn, swallows its own errors,
  `grounded` matches `sources.length > 0` in both the grounded and ungrounded-fallback cases)
- `apps/api/src/routes/analytics.ts` — add `GET /v1/analytics/performance` under the existing `gate`
- `apps/api/src/services/analytics-service.ts` — add `recordTurnMetric` and
  `getPerformanceAnalytics`, reusing the module's existing `windowStart()` helper
- `apps/api/src/services/analytics-service.test.ts` — extend with `getPerformanceAnalytics` and
  `recordTurnMetric` cases
- `apps/api/src/routes/analytics.test.ts` — extend with the new route's OWNER-gate and
  PARTNER-rejection cases
- `packages/shared/src/analytics/schema.ts` — add `performanceAnalyticsResponseSchema` and its
  nested `avgLatencyMsSchema`/`knowledgeUtilizationTrendPointSchema`, exported via the existing
  `packages/shared/src/analytics/index.ts`
- `apps/dashboard/lib/api-client.ts` — add `getPerformanceAnalytics(days?)`, same shape as
  `getUsageAnalytics()`
- `apps/dashboard/app/(dashboard)/analytics/page.tsx` — render `PerformanceAnalyticsSummary`,
  extend subtitle copy with the real-traffic / grounded-rate-not-accuracy / satisfaction-deferred
  disclosures
- `apps/dashboard/app/(dashboard)/analytics/page.module.css` — add a trend-row style only if the
  existing shared classes don't cover it

## Files to Create

- `prisma/migrations/<ts>_add_turn_metrics/migration.sql`
- `prisma/migrations/<ts>_turn_metrics_rls/migration.sql`
- `apps/dashboard/app/(dashboard)/analytics/PerformanceAnalyticsSummary.tsx`
- `apps/dashboard/app/(dashboard)/analytics/PerformanceAnalyticsSummary.test.tsx`

---

## Dependencies

```
No new dependencies. aggregate/groupBy/count are existing Prisma client methods.
```

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Maintain tenant isolation using `org_id` — every query through `withOrg`; `TurnMetric` gets the
  same RLS policy shape as every other tenant table
- `requireRole("OWNER")` on the new endpoint — no PARTNER/MEMBER access
- Validate the query params and response with Zod schemas in `packages/shared`
- Use strict TypeScript, no `any`
- The new turn-completion write must never be `await`ed inline in the turn's critical path and must
  never throw into the caller — get a `latency-auditor` review on that diff specifically
- Guard every average/rate against a zero-denominator — return `0`/`null`, never `NaN`
  (`turnCount === 0` ⇒ `avgLatencyMs.*` and `groundedReplyRate` all `null`)
- Never label `groundedReplyRate` as "accuracy" anywhere in code, schema comments, or UI copy — it
  measures grounding-in-knowledge-base, not factual correctness. Never claim user-satisfaction data
  exists — it doesn't, and this spec doesn't add it
- Run `pnpm verify`

---

## Testing

- **Unit** (`analytics-service.test.ts`) — `getPerformanceAnalytics`: zero-turn org (all
  nulls/zeros, no `NaN`), mixed grounded/ungrounded turns (`groundedReplyRate` correct), a turn
  missing a hop (e.g. `retrievalMs` null because retrieval was skipped) excluded from that hop's
  average without dragging `turnCount` down; `knowledgeUtilizationTrend` returns exactly 14 points,
  oldest first, a day with zero events returns `0` not an absent entry; `days=7/30/90` boundary
  correctness on the latency/grounded fields (independent of the fixed 14-day trend window).
  `recordTurnMetric`: writes with both a null and non-null `trainingSessionId`.
- **Unit** (`conversation-service.test.ts`) — the new write fires for both a rehearsal session and
  an embed session; a rejected write doesn't fail or delay the turn; `grounded` reflects
  `sources.length > 0` for both the grounded and Priority-3-fallback cases.
- **Integration** (`analytics.test.ts`) — `GET /v1/analytics/performance`: 200 shape for OWNER,
  403 for MEMBER and PARTNER, 401 unauthenticated, 400 on an invalid `days` value.
- **Two-org isolation test** — org A's request never includes org B's `TurnMetric` rows, even with
  overlapping turn timestamps.
- **End-to-End** — manual: run a rehearsal session that triggers a grounded reply and one that
  degrades to ungrounded generation (e.g. ask about a topic with no uploaded material), then load
  `/analytics` as OWNER and confirm turn count, avg latency figures, and grounded-reply rate all
  match; confirm the 14-day trend row renders and matches `KnowledgeAccessEvent` counts for the
  days already exercised by earlier `dashboard-analytics.md` verification.
- **Realtime** — `latency-auditor` review of the `conversation-service.ts` diff; confirm via
  `pnpm bench:latency` that the new fire-and-forget write does not move turn latency.
- **Manual Verification** — non-OWNER cannot reach the new section (page-level gate already
  enforced by `dashboard-analytics.md`); cross-tenant: org A's OWNER cannot see org B's numbers even
  with a guessed query; subtitle copy correctly discloses the grounded-rate-not-accuracy and
  satisfaction-not-available caveats.

---

## Definition of Done

- Feature works end-to-end (OWNER sees real, org-wide turn count, per-hop avg latency,
  grounded-reply rate, and a 14-day knowledge-utilization trend, all computed from persisted data,
  correctly labeled as real production traffic and correctly *not* labeled as "accuracy")
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained — `latency-auditor` clean on the turn-completion-path diff,
  `pnpm bench:latency` shows no regression
- No security regressions (RLS on the new table, OWNER-only gate, two-org isolation test passes)
