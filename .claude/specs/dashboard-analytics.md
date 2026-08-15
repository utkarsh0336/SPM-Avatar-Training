# Spec: Dashboard Analytics

## Overview

Adds a real, org-wide usage-analytics view to the trainer dashboard: active users, total
conversations, average session duration, and most-accessed knowledge areas. Today nothing in this
product computes any of these numbers. `apps/dashboard/app/(dashboard)/page.tsx`'s "Total
Conversations" stat is `sessions.length + voiceSessions.length` from whatever page of
`SessionsContext`/`VoiceSessionsContext` happens to be loaded client-side — not a query, not
org-wide, not persisted. Per-turn latency is computed by
`packages/shared/src/tutor/latency-log.ts` and only ever `console.log`'d (`apps/api` runs
`Fastify({logger:false})`, so this is the *only* record — nothing durable). The one genuine
aggregate-adjacent data in the system is `ObjectiveProgress`, and
`.claude/specs/training-effectiveness-measurement.md` already turned that into a *per-curriculum
mastery* view (completion rate, pass rate, time-to-competency). This spec is the other half of
`docs/ROADMAP.md` Phase 5's "analytics" line — org-level *usage/engagement*, not per-curriculum
*learning outcomes* — and does not touch or duplicate that spec's endpoint, table, or UI.

**Scope-defining finding, not obvious from the roadmap text:** the public embed widget
(`apps/widget`) never creates a `TrainingSession` row. It authenticates anonymously via
`POST /v1/embed/ticket` and streams straight to the realtime WS — `conversation-service.ts`'s own
doc comment on `ConversationHandlerDeps.trainingSessionId` says this outright: "apps/widget embed
sessions, which have no persisted row." `TrainingSession`/`Message` (owned by
`.claude/specs/video-chat-session.md`) is populated only by the dashboard's own rehearsal
surfaces — `apps/dashboard/app/sessions` (`kind=VIDEO_CHAT`) and `apps/dashboard/app/voice-ai`
(`kind=VOICE_ONLY`) — where a trainer is logged in and testing their own avatar. So:

- **Active users**, **total conversations**, and **avg session duration** can only be computed
  from `TrainingSession`, which means they measure *trainer rehearsal activity in the dashboard*,
  not production embed traffic on customer sites. This spec ships them as exactly that, labeled
  honestly in the UI, rather than silently mislabeling rehearsal counts as "product usage."
  Real embed-traffic analytics needs its own anonymized, non-identity-linked telemetry design
  (aggregate counters, not per-learner rows — anonymity there is deliberate, not a gap) and is
  explicitly deferred to a follow-up spec.
- **Most-accessed knowledge areas** is different: `retrieveContext` (`retrieval-service.ts`) runs
  for *every* session — embed and rehearsal alike — so the new access-event write this spec adds
  (see Realtime Changes) captures real usage across both. This one metric is org-wide and genuine;
  the other three are rehearsal-only and labeled as such.

---

## Business Goal

The session status going into this feature: "Built: nothing counts as real analytics... What's
left — essentially the whole section: No usage analytics: active users, total conversations,
session duration, most-accessed knowledge areas." A trainer/OWNER currently has no way to answer
"is anyone actually using this" beyond eyeballing a session list. This spec gives OWNERs a single
view answering that, built entirely from data the product already writes (`TrainingSession`) plus
one small new event stream for knowledge usage — no speculative new subsystems.

---

## Depends On

- `.claude/specs/video-chat-session.md` (owns `TrainingSession`/`Message`, the source of three of
  the four metrics)
- `.claude/specs/knowledge-management.md` (owns `KnowledgeDocument`/`KnowledgeChunk` and
  `retrieval-service.ts`, the source of the fourth metric)
- `.claude/specs/tenant-branding.md` / `.claude/specs/dashboard-localization.md` (the OWNER-only
  page-gate and locale-dictionary conventions this spec reuses, see UI Changes)

---

## Components Affected

- `apps/api` — new analytics endpoint + service, new fire-and-forget write in the retrieval path
- `apps/dashboard` — new `/analytics` page, sidebar nav entry, locale strings
- `packages/shared` — new Zod contracts for the analytics response
- Database — one new table (`KnowledgeAccessEvent`)

---

## API Changes

- `GET /v1/analytics/usage` — new. Its own route file (`analytics.ts`), not folded into
  `org.ts` (org-config only) or `curriculum.ts` (curriculum-scoped) — this reads across two
  domains neither of those files owns. Gate: `requireRole("OWNER")`, same as
  `PATCH /v1/org/branding` — org-wide usage numbers are business-sensitive the same way branding
  is, and unlike `curriculum.ts`'s `readGate`, PARTNER (external, scoped to its own
  `PARTNER_ENABLEMENT` curricula) has no reason to see them.

  Query: `?days=7|30|90` (Zod enum, default `30`). Rejecting arbitrary ranges keeps the query
  bounded — no unindexed full-table scans from a caller passing `days=36500`.

  200:

  ```ts
  {
    windowDays: 7 | 30 | 90;
    generatedAt: string; // ISO timestamp

    // Rehearsal-only — see Overview's scope-defining finding. Computed over
    // TrainingSession rows with createdAt >= now - windowDays.
    activeUserCount: number;              // distinct createdByUserId
    totalConversationCount: number;       // row count
    avgSessionDurationSeconds: number | null; // avg(endedAt - createdAt) over status=ENDED rows; null if none ended

    // Org-wide, real usage — captures both dashboard rehearsal and embed
    // widget traffic, since retrieveContext runs on both paths.
    topKnowledgeAreas: Array<{
      documentId: string;
      documentTitle: string;
      category: string | null;
      accessCount: number; // KnowledgeAccessEvent rows in window
    }>; // top 10 by accessCount desc
  }
  ```

No changes to any existing endpoint or response shape.

---

## Database Changes

New table, additive only — no changes to any existing model's columns.

```prisma
/// Tenant-scoped. org_id + RLS policy required — see .claude/rules/tenancy.md. Written
/// fire-and-forget from conversation-service.ts whenever retrieveContext returns >=1 chunk, one
/// row per distinct documentId per turn (not per chunk — five chunks from the same document is
/// one "access", not five). trainingSessionId is null for anonymous embed sessions (same
/// nullability reasoning as conversation-service.ts's own trainingSessionId dep) — that's expected,
/// not an error state, and is exactly what makes this table's aggregate reflect real embed usage
/// unlike TrainingSession-derived metrics. Owned by .claude/specs/dashboard-analytics.md.
model KnowledgeAccessEvent {
  id                String   @id @default(uuid()) @db.Uuid
  orgId             String   @map("org_id") @db.Uuid
  documentId        String   @map("document_id") @db.Uuid
  trainingSessionId String?  @map("training_session_id") @db.Uuid
  createdAt         DateTime @default(now()) @map("created_at")

  organization    Organization      @relation(fields: [orgId], references: [id])
  document        KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  trainingSession TrainingSession?  @relation(fields: [trainingSessionId], references: [id], onDelete: SetNull)

  @@index([orgId, documentId])
  @@index([orgId, createdAt])
  @@map("knowledge_access_events")
}
```

Back-relation arrays added to `Organization`, `KnowledgeDocument`, and `TrainingSession`
(`knowledgeAccessEvents KnowledgeAccessEvent[]`), matching this schema's existing convention of
declaring both sides of every relation.

Two migrations, matching the existing `..._add_x` / `..._x_rls` pairing convention (e.g.
`20260815150000_add_training_sessions` + `20260815150100_training_sessions_rls`):

1. `..._add_knowledge_access_events` — `CREATE TABLE knowledge_access_events` + the two indexes
   above.
2. `..._knowledge_access_events_rls` — `ENABLE ROW LEVEL SECURITY` + the standard
   `app.current_org_id`-scoped policy, copied from the most recent RLS migration's template.

**Aggregation approach — a deliberate departure from precedent.** Every existing analytics-style
read in this codebase (`training-effectiveness-measurement.md`'s effectiveness endpoint) fetches
rows and reduces in JS, explicitly because no service here used `groupBy`/raw SQL. That precedent
holds for a curriculum's `ObjectiveProgress` rows (bounded by learner count × objective count, a
few hundred at most). `KnowledgeAccessEvent` doesn't have that bound — a busy org's 30-day window
could be tens of thousands of rows — and `docs/ARCHITECTURE.md` §5 explicitly warns "never run
dashboard aggregations against the primary that also serves session bootstrap." So
`getUsageAnalytics` uses Prisma's built-in `groupBy`/`count`/`aggregate` (not a new dependency,
just a first use of an existing Prisma capability) instead of fetching every row into Node. The
three `TrainingSession`-derived metrics stay well within the old fetch-and-reduce pattern's safe
range and can use it unchanged if simpler, but `topKnowledgeAreas`' `groupBy` is the one exception,
documented so a future reader doesn't "fix" it back to the old convention.

---

## UI Changes

**Dashboard — new `/analytics` page** (`apps/dashboard/app/(dashboard)/analytics/`), OWNER-only,
gated exactly like `apps/dashboard/app/(dashboard)/settings/page.tsx`: server component calls
`getMe()`, redirects to `/login` if unauthenticated, redirects to `/` if `me.role !== "OWNER"`
(MEMBER/PARTNER never see a dedicated 403 page, same precedent). Renders a new
`UsageAnalyticsSummary.tsx` (purely presentational, same convention as `EffectivenessSummary.tsx`):
a stat row (active users, total conversations, avg session duration — each labeled "dashboard
rehearsal" per Overview's scope note, not silently presented as production usage) followed by a
ranked list of the top knowledge areas by access count. A day-range control (7/30/90) re-fetches;
no custom date picker in v1 (matches this codebase's precedent of shipping the simple bounded
version first — see `training-effectiveness-measurement.md`'s own deferred-scope framing).

**Sidebar** (`apps/dashboard/app/sessions/Sidebar.tsx`) — new nav entry pointing at `/analytics`,
visible only when `org` role is OWNER (the sidebar already receives enough context via the layout;
non-OWNER sees no dead link rather than a link that redirects). `activeHub` union type gains
`"analytics"`, matched by `pathname?.startsWith("/analytics")`.

**Locale strings** — only the sidebar's `navAnalytics` label is translated (added to both
`apps/dashboard/locales/en.ts` and `apps/dashboard/locales/hi.ts`; `locale-parity.test.ts` enforces
the two stay in sync). The page's own content (heading, stat labels, day-range control) stays plain
English — checked against actual precedent during implementation: `EffectivenessSummary.tsx` (the
closest analog) and even `settings/page.tsx`'s own `<h1>`/eyebrow are hardcoded English; only
sidebar nav items and interactive form panels like `MembersPanel.tsx` are translated in this
codebase today. `dashboard-localization.md`'s shipped scope is portal chrome, not every feature
page — this spec follows that real boundary rather than the broader one implied by its own Overview
text.

```
No changes to Widget, Avatar, or the session rehearsal screen.
```

---

## Realtime Changes

One addition to the retrieval hot path in `conversation-service.ts`, right after
`retrieveKnowledge(...)` resolves and `tracker.markRetrievalDone()` is called (~line 553-559):
for each distinct `documentId` among the returned chunks, fire `recordKnowledgeAccess(orgId,
documentId, trainingSessionId)` **without awaiting it**, `.catch()`-ing internally so a DB hiccup
never surfaces as a turn failure — exactly the existing `persistTrainingSessionMessage` pattern
this file already uses for the identical reason (`.claude/rules/realtime.md`: never block the
audio path, never let write-side persistence fail a turn). Unlike
`persistTrainingSessionMessage`, this write does **not** no-op when `trainingSessionId` is null —
that's the entire point (see Overview). This is exactly the class of diff
`latency-auditor` exists to catch; **run it on the `conversation-service.ts` change before this
spec is considered done**, same as any other diff touching the realtime layer.

No changes to OpenAI Realtime event names, WebRTC, LiveKit, or the audio pipeline itself — this is
a write appended after retrieval already completes, not a new step in the turn.

---

## Files to Modify

- `prisma/schema.prisma` — new `KnowledgeAccessEvent` model, back-relation arrays on
  `Organization`, `KnowledgeDocument`, `TrainingSession`
- `apps/api/src/services/conversation-service.ts` — fire-and-forget `recordKnowledgeAccess` call
  after retrieval; new injectable dep (matches `deps.persistTrainingSessionMessage`'s convention)
- `apps/api/src/services/conversation-service.test.ts` — new tests for the write (fires for both
  null and non-null `trainingSessionId`, never awaited/blocks the turn, swallows its own errors)
- `apps/dashboard/lib/api-client.ts` — new `getUsageAnalytics(days?)` wrapper
- `apps/dashboard/app/sessions/Sidebar.tsx`, `Sidebar.module.css` — new nav entry, `activeHub`
  union extension
- `apps/dashboard/locales/en.ts`, `apps/dashboard/locales/hi.ts` — new keys
- `packages/shared/src/index.ts` — `export * from "./analytics/index.js";`

## Files to Create

- `apps/api/src/routes/analytics.ts` — `GET /v1/analytics/usage`
- `apps/api/src/routes/analytics.test.ts`
- `apps/api/src/services/analytics-service.ts` — `getUsageAnalytics(orgId, windowDays)`
- `apps/api/src/services/analytics-service.test.ts`
- `packages/shared/src/analytics/schema.ts` — `usageAnalyticsQuerySchema`,
  `usageAnalyticsResponseSchema`, `knowledgeAreaSchema`
- `packages/shared/src/analytics/index.ts` — barrel
- `prisma/migrations/<ts>_add_knowledge_access_events/migration.sql`
- `prisma/migrations/<ts>_knowledge_access_events_rls/migration.sql`
- `apps/dashboard/app/(dashboard)/analytics/page.tsx`
- `apps/dashboard/app/(dashboard)/analytics/page.test.tsx`
- `apps/dashboard/app/(dashboard)/analytics/UsageAnalyticsSummary.tsx`
- `apps/dashboard/app/(dashboard)/analytics/UsageAnalyticsSummary.test.tsx`
- `apps/dashboard/app/(dashboard)/analytics/page.module.css`

---

## Dependencies

```
No new dependencies. groupBy/count/aggregate are existing Prisma client methods.
```

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Maintain tenant isolation using `org_id` — every query through `withOrg`; the new
  `KnowledgeAccessEvent` table gets the same RLS policy shape as every other tenant table
- `requireRole("OWNER")` on the new endpoint — no PARTNER/MEMBER access
- Validate the query params and response with Zod schemas in `packages/shared`
- Use strict TypeScript, no `any`
- The new retrieval-path write must never be `await`ed inline in the turn's critical path and must
  never throw into the caller — get a `latency-auditor` review on that diff specifically
- Guard every division/average against a zero-denominator — return `0`/`null`, never `NaN`
- Run `pnpm verify`

---

## Testing

- **Unit** (`analytics-service.test.ts`) — `getUsageAnalytics`: zero-session org (all zeros/nulls,
  no `NaN`), mix of ACTIVE/ENDED sessions (duration only averages ENDED rows), multiple sessions
  from the same user (counted once in `activeUserCount`), knowledge areas ranked correctly and
  capped at 10, a session/event outside the window excluded, `days=7/30/90` boundary correctness.
- **Unit** (`conversation-service.test.ts`) — the new write fires for both a rehearsal session
  (`trainingSessionId` set) and an embed session (`trainingSessionId` null); a rejected write
  doesn't fail or delay the turn; one event per distinct `documentId`, not per chunk.
- **Integration** (`analytics.test.ts`) — `GET /v1/analytics/usage`: 200 shape for OWNER, redirect/
  403 for MEMBER and PARTNER, 401 unauthenticated, 400 on an invalid `days` value.
- **Two-org isolation test** — org A's request never includes org B's `TrainingSession` or
  `KnowledgeAccessEvent` rows, even with matching document titles.
- **End-to-End** — manual: run two rehearsal sessions (one ended, one active) as different users,
  ask a question that triggers a real knowledge retrieval, then load `/analytics` as OWNER and
  confirm active users, total conversations, avg duration (from the one ended session), and the
  retrieved document's access count all match.
- **Realtime** — `latency-auditor` review of the `conversation-service.ts` diff; confirm via
  `pnpm bench:latency` that the new fire-and-forget write does not move turn latency.
- **Manual Verification** — non-OWNER cannot reach `/analytics` (redirected); cross-tenant: org A's
  OWNER cannot see org B's numbers even with a guessed query.

---

## Definition of Done

- Feature works end-to-end (OWNER sees real active-user, conversation, duration, and
  knowledge-area numbers computed from persisted data, correctly labeled as rehearsal-scoped where
  applicable)
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained — `latency-auditor` clean on the retrieval-path diff,
  `pnpm bench:latency` shows no regression
- No security regressions (RLS on the new table, OWNER-only gate, two-org isolation test passes)
