# Spec: User Satisfaction

## Overview

Adds the last of the three items `ai-performance-analytics.md`'s Overview named and deliberately
left out of 3.9.4 — response accuracy, user satisfaction, conversation quality — that actually has
a non-speculative scope to build. This one does: it needs a capture mechanism, not a new judge/
scoring subsystem. The other two still do (no ground-truth judge, no "quality" metric exists
anywhere in this codebase) and remain explicitly out of scope here, same as before.

Adds:

- A 1–5 star rating + optional short comment, captured from the public `apps/widget` embed when a
  learner ends a session, sent over the session's own already-authenticated realtime WebSocket
  channel as a new client→server message (`session.rate`) rather than a new HTTP route.
- A new `SatisfactionRating` table, written fire-and-forget from
  `conversation-service.ts` — same posture as `TurnMetric`/`KnowledgeAccessEvent`.
- `GET /v1/analytics/satisfaction` (OWNER-only, windowed) and a fourth summary section on the
  dashboard's existing `/analytics` page: rating count, average rating, and a 1–5 distribution.

**Scope-defining finding:** `apps/widget/src/App.tsx` today has no "end session" affordance at
all — a session only ends via component unmount, a closed tab, or the parent frame's
`avatrain:destroy` postMessage. There is nowhere to hang a "how did that go?" prompt without first
giving the widget an explicit end action. This spec adds a minimal one (a "Leave" control) whose
sole purpose is to host the rating prompt before disconnecting — it is not a general session-
management feature.

**Why the WS channel, not a new `POST /v1/embed/...` route:** every session already has an
authenticated, ticket-scoped WebSocket open (`.claude/rules/realtime.md`: "Never invent a second
auth path for this route"). A new publishable-key-only HTTP endpoint would need its own rate limit,
origin check, and CORS handling duplicating `routes/embed.ts`, to authenticate something strictly
weaker than the connection the learner already has open. Reusing the socket is less surface, not
more: one new Zod message in `ws-messages.ts`, one new `case` in `conversation-service.ts`'s
existing switch — the same file and pattern `barge_in`/`session.end` already use.

**Why dashboard rehearsal surfaces don't get this UI:** `TurnMetric`/`KnowledgeAccessEvent` are
meaningful on both the dashboard-rehearsal and embed paths because the *pipeline event itself*
(a turn happened, a retrieval happened) means the same thing either way. A trainer rating their own
rehearsal doesn't — there's no learner whose satisfaction is being measured. `SatisfactionRating`
still carries a nullable `trainingSessionId` (same convention as its siblings, and the WS handler
that writes it is shared code either way, not a duplicated implementation) so this isn't foreclosed
later, but no dashboard UI sends `session.rate` in this spec. Every row this spec actually produces
will have `trainingSessionId: null` and come from anonymous embed traffic — which makes it, like
`groundedReplyRate`, real and org-wide rather than rehearsal-only.

---

## Business Goal

The session status going into this feature: 3.9.4 shipped latency and grounded-reply rate — an
OWNER can now tell if the avatar is fast and grounded. It still cannot tell whether real learners
were *happy* with a session: no rating widget, no thumbs, no feedback table exists anywhere in this
codebase, including `apps/widget`. `dashboard-analytics.md`'s deferred "real embed-traffic
analytics" and `training-analytics.md`'s deferred "transcript search" both got named follow-ups
before being built; this is `ai-performance-analytics.md`'s equivalent named follow-up. The
dashboard's own `/analytics` page subtitle currently states outright that "user-satisfaction data
isn't available yet" — this spec is what removes that sentence.

---

## Depends On

- `.claude/specs/ai-performance-analytics.md` (names this as the deferred follow-up; established
  the dual-path/nullable-`trainingSessionId` convention this table reuses)
- `.claude/specs/dashboard-analytics.md` (owns the `/analytics` page, its OWNER-only gate, and the
  windowed day-range-control convention this spec's new section reuses)
- `.claude/specs/video-chat-session.md` (owns `TrainingSession`, the nullable FK this spec's new
  table reuses)
- `packages/shared/src/realtime/ws-messages.ts` (owns the client/server message discriminated
  unions this spec extends — not modified in a way that breaks existing message shapes, only
  additive)

---

## Components Affected

- apps/api
- apps/widget
- apps/dashboard
- packages/realtime-core
- packages/shared

`apps/agent` (LiveKit Mode B) is not touched — Mode B is a separate transport
(`.claude/specs/ai-voice-livekit.md`); `TurnMetric`/`KnowledgeAccessEvent` were never wired into it
either, so this spec doesn't establish new precedent by skipping it.

---

## API Changes

- No new public HTTP route for submitting a rating — see Overview. Rating capture is a new
  client→server WebSocket message on the existing `/v1/conversations/:trainingSessionId/ws` route
  (see Realtime Changes).
- New: `GET /v1/analytics/satisfaction` (OWNER-only, same gate as `/v1/analytics/usage` and
  `/v1/analytics/performance`) — `?days=7|30|90`, defaults to 30, reusing
  `usageAnalyticsQuerySchema`. Returns `SatisfactionAnalyticsResponse`.

---

## Database Changes

New table `satisfaction_ratings`, RLS-required per `.claude/rules/tenancy.md`, mirroring
`turn_metrics`'/`knowledge_access_events`' shape:

```prisma
model SatisfactionRating {
  id                String   @id @default(uuid()) @db.Uuid
  orgId             String   @map("org_id") @db.Uuid
  trainingSessionId String?  @map("training_session_id") @db.Uuid
  rating            Int
  comment           String?  @db.Text
  createdAt         DateTime @default(now()) @map("created_at")

  organization    Organization     @relation(fields: [orgId], references: [id])
  trainingSession TrainingSession? @relation(fields: [trainingSessionId], references: [id], onDelete: SetNull)

  @@index([orgId, createdAt])
  @@map("satisfaction_ratings")
}
```

- `rating` is validated to the closed range 1–5 at the Zod message boundary
  (`sessionRateMessageSchema`), not a DB `CHECK` constraint — no other table in this schema uses
  one; range validation happens at the same layer `ObjectiveProgressVerdict`'s enum does semantic
  validation.
- `comment` passed through `redact()` (`packages/shared/src/redact.ts`) before insert, same
  convention as `Message.content` — that function is still a no-op stub; not silently treated as
  real PII scrubbing.
- `trainingSessionId` nullable, `onDelete: SetNull` — identical convention to
  `TurnMetric.trainingSessionId`/`KnowledgeAccessEvent.trainingSessionId`.
- Two migrations, continuing the `turn_metrics` two-file convention:
  `20260815180000_add_satisfaction_ratings` (table + indexes + FKs) and
  `20260815180100_satisfaction_ratings_rls` (`ENABLE`/`FORCE ROW LEVEL SECURITY` +
  `tenant_isolation` policy on `org_id`).

---

## UI Changes

**Widget** (`apps/widget`):
- New minimal "Leave" control in `App.tsx` (none exists today — see Overview). Clicking it shows a
  1–5 star prompt with an optional short comment field and a "Skip"/"Submit" pair, inline in the
  existing single-component layout (no new component file — matches this app's current
  one-file-plus-hook shape). Submitting calls the new `rateSession()` method on the session handle,
  then `disconnect()`; Skip just calls `disconnect()`.
- `useEmbedSession.ts` exposes `rateSession(rating, comment?)` from its returned handle, delegating
  to `connectConversationSession`'s new method.

**Dashboard** (`apps/dashboard`):
- New `SatisfactionAnalyticsSummary.tsx` under `app/(dashboard)/analytics/`, same self-contained
  fetch/window-switcher shape as `PerformanceAnalyticsSummary.tsx`: average rating, rating count,
  and a 1–5 bar distribution. Stacked below `PerformanceAnalyticsSummary` on `page.tsx`, no new nav
  entry (same "no new section, stack on the existing page" convention `training-analytics.md`
  established).
- `page.tsx`'s hero subtitle updated: removes "user-satisfaction data isn't available yet" and
  states satisfaction is real/org-wide (anonymous embed traffic only — see Overview), same
  labeling convention the other three sections already use for their own scope.

**No changes** to `apps/dashboard/app/sessions/[trainingSessionId]` or
`apps/dashboard/app/voice-ai/[voiceSessionId]` — see Overview's "why dashboard rehearsal surfaces
don't get this UI."

---

## Realtime Changes

- `packages/shared/src/realtime/ws-messages.ts`: new client→server message
  `sessionRateMessageSchema` —
  `{ type: "session.rate", rating: z.number().int().min(1).max(5), comment: z.string().max(500).optional() }`
  — added to `clientMessageSchema`'s discriminated union. No new server→client ack; fire-and-forget
  from the client, same as `barge_in`/`session.end` today.
- `apps/api/src/services/conversation-service.ts`: new `case "session.rate":` in
  `handleClientMessage`'s switch, placed before `case "session.end"`. Calls a new fire-and-forget
  `recordSatisfactionRating(claims.orgId, trainingSessionId, message.rating, message.comment ?? null)`
  — same try/catch-and-`console.error`-only posture as `recordTurnMetric`, never awaited by the
  handler, never throws into the socket.
- `packages/realtime-core/src/conversation-session.ts`: the object `connectConversationSession`
  returns gains `rateSession(rating: number, comment?: string): void`, sending the message over the
  still-open socket. Must be called before `disconnect()` (which closes the socket) — `disconnect()`
  itself is unchanged.
- Not on the hot per-chunk audio path — sent at most once, at session end, same latency posture as
  `session.end` itself. No transport change: still the plain WebSocket
  (`.claude/rules/realtime.md`), not OpenAI Realtime/WebRTC.

---

## Files to Modify

- `prisma/schema.prisma`
- `packages/shared/src/realtime/ws-messages.ts`
- `packages/shared/src/analytics/schema.ts`
- `packages/realtime-core/src/conversation-session.ts`
- `apps/api/src/services/conversation-service.ts`
- `apps/api/src/services/analytics-service.ts`
- `apps/api/src/routes/analytics.ts`
- `apps/widget/src/App.tsx`
- `apps/widget/src/App.module.css`
- `apps/widget/src/useEmbedSession.ts`
- `apps/dashboard/lib/api-client.ts`
- `apps/dashboard/app/(dashboard)/analytics/page.tsx`
- `apps/dashboard/app/(dashboard)/analytics/page.module.css`

---

## Files to Create

- `prisma/migrations/20260815180000_add_satisfaction_ratings/migration.sql`
- `prisma/migrations/20260815180100_satisfaction_ratings_rls/migration.sql`
- `apps/dashboard/app/(dashboard)/analytics/SatisfactionAnalyticsSummary.tsx`
- `apps/dashboard/app/(dashboard)/analytics/SatisfactionAnalyticsSummary.test.tsx`

---

## Dependencies

No new dependencies.

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY`
- Maintain tenant isolation using `org_id`
- Keep provider-specific logic inside adapters
- Validate APIs with Zod
- Preserve the public embed SDK contract — no `packages/embed` postMessage or public HTTP route
  changes in this spec; only the internal WS wire format `apps/widget` already uses once mounted
  gets a new message
- Keep realtime latency low — `session.rate` is fire-and-forget, sent once, at session end, never
  inline in a hot per-chunk callback
- Use strict TypeScript
- Never use `any`
- Prefer modifying existing code
- Run `pnpm verify`
- Update documentation when public APIs change (`docs/embed-contract.md` is unaffected — see above)

---

## Testing

- Unit Tests: `sessionRateMessageSchema` accepts 1–5, rejects 0/6/non-integer; `analytics-service.test.ts`
  covers `recordSatisfactionRating` and `getSatisfactionAnalytics` (empty-state null `avgRating`,
  zero-filled 1–5 distribution, windowing).
- Integration Tests: `conversation-service.test.ts` covers the new `session.rate` case, including
  that it never throws/blocks when `trainingSessionId` is null; `analytics.test.ts` covers
  `GET /v1/analytics/satisfaction`'s OWNER gate and windowing, matching `analytics.test.ts`'s
  existing structure for the other three endpoints.
- Two-org isolation test for `satisfaction_ratings`, per `.claude/rules/tenancy.md`.
- End-to-End Tests: widget "Leave" → rate → submit → row persisted with `trainingSessionId: null`.
- Realtime Tests: `conversation-session.test.ts` covers `rateSession()` sending the correct message
  shape on the mock socket before `disconnect()` closes it.
- Latency Benchmarks: not applicable — no change to the turn-processing hot path; `latency-auditor`
  should still review the `conversation-service.ts` diff per this codebase's standing convention for
  any realtime-layer change.
- Manual Verification: submit a rating from a real embed session, confirm it appears in
  `SatisfactionAnalyticsSummary` on `/analytics` within the selected window.

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
