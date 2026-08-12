# Spec: Interactive Assessment

## Overview

Gives the AI avatar a real, server-verified way to check whether a learner actually understood
what it just taught, and to remember that across the session. Today the avatar's "quiz at the
end" behavior (`packages/shared/src/tutor/system-prompt.ts:50-54`) is a single line of prompt
text — the model may say it's quizzing the learner, but nothing is graded, nothing is recorded,
and a reconnect or a new session starts from zero every time. This feature makes that real:
a trainer authors a small ordered list of teachable **Objectives** for an avatar (a
**Curriculum**), the avatar calls a `start_checkpoint` tool when it moves to checking one, the
server — never the model — grades the learner's actual transcribed answer against that
objective's criteria (`grade_answer`), persists the verdict (`record_progress`), and the avatar
can confirm the whole curriculum is done (`end_module`).

This is SOW §3.4 ("Training & Learning Management Module") and §3.5 ("Interactive Learning &
Assessment") and corresponds to `docs/ROADMAP.md` Phase 3 ("It actually teaches"), scoped down —
see "Scope decisions" below. It is the direct follow-up `.claude/specs/knowledge-management.md`
named: "The tool-registry approach remains the target for the follow-up Assessment/LMS feature
(SOW §3.4/3.5), where `record_progress`/`grade_answer` are already forward-referenced in
`.claude/rules/tenancy.md`." Those two tool names, plus `ObjectiveProgress` as a model name and
the rule that both tools are `serverOnly`, are pre-committed by that rules file — this spec
implements them, it does not get to rename them.

### Scope decisions

- **Curriculum, not the full §3.4 LMS.** SOW §3.4 separately describes employee onboarding,
  compliance training, customer education, and partner enablement as distinct program types with
  their own categorization. None of that content-taxonomy/audience-targeting layer is built here
  — one `Curriculum` is just an ordered list of `Objective`s attached to one `Avatar`. Multiple
  curricula per avatar, curriculum reuse across avatars, and audience/program-type tagging are
  deferred to a follow-up Training Catalog spec, the same way this spec itself was deferred out
  of knowledge-management.
- **`search_knowledge` stays retrieve-then-inject.** `docs/ROADMAP.md`'s Phase 3 bullet lists
  `search_knowledge` alongside the tools this spec builds, but it already works
  (`conversation-service.ts`'s existing `retrieveKnowledge` call) and meets its latency budget
  (`RETRIEVAL_TIMEOUT_MS = 250`). Converting a working, budget-meeting mechanism into a
  model-invoked tool call — an extra round trip inside the same turn — for no functional gain
  would fight `docs/ARCHITECTURE.md` §5's retrieval budget for no reason. Not built here.
- **`show_asset` is out of scope.** No asset/media display system exists anywhere in the product
  yet; there is nothing for this tool to show. Not built here.
- **No widget UI.** `apps/widget/src/App.tsx` is still the literal Phase-0 placeholder
  (`<h1>Avatrain Widget</h1>`) — confirmed by `.claude/specs/ai-voice-livekit.md`'s own "Depends
  On" section. The only real, working conversational surface today is the dashboard's trainer
  rehearsal screen (`apps/dashboard/app/sessions/[trainingSessionId]/`). Checkpoint/grading
  feedback surfaces there. Embeddable widget UI for this feature is Phase 4 territory.
- **No new persisted session/message table.** `.claude/specs/video-chat-session.md` designed a
  `TrainingSession`/`Message` persistence layer, but it was never built — `prisma/schema.prisma`
  has no such models, and the real conversation pipeline
  (`apps/api/src/routes/conversations.ts` + `conversation-service.ts`) treats
  `trainingSessionId` as an opaque route param, not a foreign key. This spec does not take on
  building that persistence as a hidden prerequisite: `ObjectiveProgress` is keyed directly on
  `(objectiveId, learnerId)` — `learnerId` being `WsTicketClaims.userId`, which is always a real,
  authenticated `User.id` today (minted only via the authenticated `POST
  /v1/conversations/ticket`, see `apps/api/src/lib/ws-tickets.ts`). `.claude/rules/tenancy.md`'s
  "Unsigned (anonymous) identity may never write to `ObjectiveProgress`" rule is satisfied by
  construction today — there is no anonymous code path into `conversation-service.ts` at all. It
  becomes an enforceable, testable rule once Phase 4 adds one; noted here so it isn't forgotten
  then.
- **Grading criteria are trainer-authored text, not retrieval-grounded.** `grade_answer` judges
  the learner's answer against the objective's own `gradingCriteria` field, not against
  `KnowledgeChunk` search results. Grounding grading directly in source documents is a plausible
  future enhancement, deliberately deferred rather than built speculatively.
- **One `ObjectiveProgress` row per (objective, learner), not a full attempt log.** Upserted on
  every `grade_answer` + `record_progress` pair (verdict/feedback overwritten, `attempts`
  incremented). A full historical attempt log is deferred — `attempts` is retained so it isn't a
  breaking schema change to add later.

---

## Business Goal

Implements SOW §3.5 directly: "Interactive learning sessions... Knowledge assessments...
Scenario-based questioning... Training effectiveness measurement" and the Phase 3 exit criteria
in `docs/ROADMAP.md` ("Wrong answers trigger remediation, not just 'incorrect'";
`ObjectiveProgress` reflects the session accurately"). Without it, "the avatar quizzes you" is a
claim the product makes in its system prompt but cannot back up — no answer is ever actually
graded, no wrong answer ever gets remediation instead of just moving on, and a trainer has no way
to see whether learners are actually passing checkpoints. This is also the prerequisite
architecture (tool-calling support in `LLMProvider`) that any later SOW §3.5 "adaptive learning
paths" or §3.9 "Learning effectiveness metrics" work will build on.

---

## Depends On

- `.claude/specs/knowledge-management.md` (retrieval pipeline `conversation-service.ts` hooks
  into; this spec adds the tool-loop alongside it in the same file)
- `.claude/specs/ai-avatar.md`, `.claude/specs/avatar-builder-customization.md` (the `Avatar`
  model this feature attaches a `Curriculum` to)
- `.claude/specs/authentication.md` (OWNER-gated admin routes reuse `requireRole("OWNER")`)

---

## Components Affected

- `apps/api` — new `curriculum.ts`/`progress.ts` routes and services; `conversation-service.ts`
  gains a server-side tool-call loop
- `apps/dashboard` — new Curriculum admin page; checkpoint/grading feedback added to the existing
  session rehearsal screen
- `packages/shared` — new `curriculum` subpath (Zod contracts, tool JSON-schema definitions);
  `LLMProvider`/`LLMMessage` interface extended for tool calling; Gemini/Groq adapters and
  `llm-failover.ts` updated; `system-prompt.ts` extended to inject curriculum context; new
  `ws-messages.ts` server message types

---

## API Changes

All new routes gated `{ preHandler: [app.authenticate, requireRole("OWNER")] }`, mirroring
`apps/api/src/routes/knowledge.ts` exactly (content curation is OWNER-only until the `Role` enum
grows a finer tier — same rationale already recorded in `knowledge.ts`).

- `POST /v1/curricula` — body `{ avatarId, title }`. Creates a curriculum for an avatar. 201.
  409 (`curriculum_exists`) if the avatar already has one (`Curriculum.avatarId` is `@unique`;
  one curriculum per avatar in this scope, see Overview).
- `GET /v1/curricula/:curriculumId` — curriculum + ordered objectives. 200 or 404.
- `PUT /v1/curricula/:curriculumId/objectives` — body: ordered array of
  `{ id?, title, teachingContent, checkQuestion, gradingCriteria }`. Replace-the-whole-list
  semantics (trainer edits the full ordered list and saves in one call) — the same
  no-separate-draft-workflow scoping precedent `knowledge-management.md` used for its own
  content. Service diffs by `id`: upserts entries with an `id`, inserts entries without one,
  deletes objectives missing from the new list, and sets `order` from array index. 200 with the
  saved list.
- `DELETE /v1/curricula/:curriculumId` — 204. Cascades to `Objective`/`ObjectiveProgress`.
- `GET /v1/curricula/:curriculumId/progress` — `ObjectiveProgress` rows joined with learner email
  and objective title, for the results view. 200.

```
No changes to /v1/conversations/* routes — the tool loop lives inside the existing WS handler,
not a new HTTP surface.
```

---

## Database Changes

Three new tenant-scoped tables, `org_id` + RLS on all three, mirroring the exact pattern
`20260812052735_knowledge_rls`'s migration used for `knowledge_documents`/`knowledge_chunks`
(`CREATE POLICY tenant_isolation ... USING (org_id = NULLIF(current_setting('app.current_org_id'), '')::uuid)`).

```prisma
enum ObjectiveProgressVerdict {
  PASS
  RETRY
}

/// Tenant-scoped. org_id + RLS policy required — see .claude/rules/tenancy.md. One curriculum
/// per Avatar (1:1) — see Spec's "Scope decisions". Multi-curriculum-per-avatar and
/// avatar-agnostic curricula are deferred.
model Curriculum {
  id          String   @id @default(uuid()) @db.Uuid
  orgId       String   @map("org_id") @db.Uuid
  avatarId    String   @unique @map("avatar_id") @db.Uuid
  createdById String   @map("created_by_id") @db.Uuid
  title       String
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  organization Organization @relation(fields: [orgId], references: [id])
  avatar       Avatar       @relation(fields: [avatarId], references: [id])
  objectives   Objective[]

  @@index([orgId])
  @@map("curricula")
}

/// Tenant-scoped. orgId denormalized from Curriculum, same reasoning as KnowledgeChunk (RLS and
/// lookups filter on an indexed column directly, no join needed). One teachable, checkable unit.
model Objective {
  id              String   @id @default(uuid()) @db.Uuid
  orgId           String   @map("org_id") @db.Uuid
  curriculumId    String   @map("curriculum_id") @db.Uuid
  order           Int
  title           String
  teachingContent String   @map("teaching_content")
  checkQuestion   String   @map("check_question")
  gradingCriteria String   @map("grading_criteria")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  organization Organization        @relation(fields: [orgId], references: [id])
  curriculum   Curriculum          @relation(fields: [curriculumId], references: [id], onDelete: Cascade)
  progress     ObjectiveProgress[]

  @@unique([curriculumId, order])
  @@index([orgId])
  @@index([curriculumId])
  @@map("objectives")
}

/// Tenant-scoped. Server-only writes — record_progress is serverOnly per
/// .claude/rules/tenancy.md. Never written from a route driven by request-body input; only from
/// conversation-service's tool dispatcher, fed by grade_answer's own server-computed verdict for
/// the SAME turn (never a verdict argument supplied by the model).
model ObjectiveProgress {
  id          String                   @id @default(uuid()) @db.Uuid
  orgId       String                   @map("org_id") @db.Uuid
  objectiveId String                   @map("objective_id") @db.Uuid
  learnerId   String                   @map("learner_id") @db.Uuid
  verdict     ObjectiveProgressVerdict
  attempts    Int                      @default(1)
  feedback    String
  createdAt   DateTime                 @default(now()) @map("created_at")
  updatedAt   DateTime                 @updatedAt @map("updated_at")

  organization Organization @relation(fields: [orgId], references: [id])
  objective    Objective    @relation(fields: [objectiveId], references: [id], onDelete: Cascade)
  learner      User         @relation(fields: [learnerId], references: [id])

  @@unique([objectiveId, learnerId])
  @@index([orgId])
  @@index([learnerId])
  @@map("objective_progress")
}
```

Additive relation fields: `Organization.curricula`/`objectives`/`objectiveProgresses`,
`Avatar.curriculum`, `User.objectiveProgresses`. Two migrations, matching the existing
add-table-then-RLS pairing convention (`20260812052645_add_knowledge_management` +
`20260812052735_knowledge_rls`).

---

## UI Changes

**Dashboard — new Curriculum admin page** (`app/(dashboard)/curriculum/`), OWNER-gated, following
`app/(dashboard)/knowledge/`'s exact convention: a Server Component `page.tsx` does the
`getMe()`/role redirect, renders a client orchestrator (`CurriculumEditor.tsx`) that owns
fetch/save state and delegates to presentational children (`ObjectiveList.tsx`,
`ObjectiveRow.tsx` for add/edit/reorder/delete, `ProgressTable.tsx` for the read-only results
view from `GET /v1/curricula/:id/progress`). No polling — authoring and viewing progress are both
on-demand actions, unlike Knowledge Base's async-ingestion-status polling.

**Dashboard — session rehearsal screen.** `apps/dashboard/app/sessions/[trainingSessionId]/`
gains a small `CheckpointFeedback.tsx`, wired into `useConversationSession.ts`'s existing
WS-message switch alongside the other `ServerMessage.type` cases, rendering the three new server
message types (below) inline in `TranscriptPanel.tsx`'s transcript — "checking your understanding
on *Objective X*...", then the verdict + feedback once graded, then a completion banner on
`module.completed`. Not a new page; small addition to the working screen.

```
No changes to Widget or Analytics — see Scope decisions.
```

---

## Realtime Changes

**`LLMProvider` gains tool-calling** (`packages/shared/src/providers/types.ts`) — a breaking
change to `chat()`'s yield type, made once and cleanly since this is an internal interface with
no external contract (unlike the embed SDK, which `CLAUDE.md` explicitly protects):

```ts
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // hand-written JSON Schema per tool — only 4 tools,
                                        // not worth a new zod-to-json-schema dependency
}

export type LLMStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown };

export interface LLMMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string; // role: "tool" only
  toolCalls?: { id: string; name: string; args: unknown }[]; // role: "assistant" only, when it made calls
}

export interface LLMChatOptions {
  systemPrompt: string;
  signal: AbortSignal;
  tools?: LLMToolDefinition[];
}

export interface LLMProvider {
  readonly name: string;
  chat(messages: LLMMessage[], opts: LLMChatOptions): AsyncIterable<LLMStreamEvent>;
}
```

Implemented in `llm-gemini.ts` (Gemini's `tools: [{ functionDeclarations }]` request field,
`candidates[0].content.parts[].functionCall` response field) and `llm-groq.ts` (OpenAI-compatible
`tools: [{ type: "function", function }]`, streamed `delta.tool_calls[]` accumulated by index
across chunks — Groq/OpenAI stream tool-call arguments in fragments, unlike text deltas). Every
existing caller of `chat()` updates for the new event-shaped yield: both adapters, both adapter
tests, `llm-failover.ts` (forwards `LLMStreamEvent`s instead of strings; "first chunk" detection
unchanged), `llm-failover.test.ts`, and `conversation-service.ts`'s streaming loop (switches on
`delta.type` instead of treating every yield as text).

**Tool dispatch loop in `conversation-service.ts`.** When the avatar's `Avatar.curriculum` exists,
`processTurn` passes the four tool definitions and loops: on a `tool_call` event, stop streaming
to TTS, run the matching server-side handler (below), append the assistant's tool-call message
and a `role: "tool"` result message to a **turn-scoped** copy of history (not the persisted
`messages` array — tool round-trips are turn-internal), and re-invoke `llm.chat()` so the model
can continue in speech. Bounded to 4 tool round-trips per turn (a pathological loop degrades to
`turn.failed`, kind: `"llm"`, not an infinite hang) and each tool handler has its own 3s timeout,
mirroring `docs/ARCHITECTURE.md` §2's "Tool timeout (>4s) → tell the model the tool failed" row
and staying inside `docs/ROADMAP.md` Phase 3's "Tool p95 < 400ms" exit criterion with headroom.
On a tool timeout, the model is told the tool call failed (a synthetic `role: "tool"` error
result) and continues — never fails the whole turn over one slow grading call.

Server-side tool handlers (all `serverOnly` per `.claude/rules/tenancy.md` — the model supplies
only an `objectiveId`, never a verdict or progress data; the server derives everything else):

- **`start_checkpoint({ objectiveId })`** — validates `objectiveId` belongs to this avatar's
  curriculum (else tool-error result), stamps it as the turn's active objective, sends
  `checkpoint.started` to the client immediately (before the tool result even returns to the
  model) so the UI shows "checking understanding" instead of dead air — the closest this
  WS-based pipeline gets to `docs/ARCHITECTURE.md`'s filler-utterance requirement, which was
  designed for a different (never-built) WebRTC/OpenAI-Realtime transport; a true spoken filler
  utterance here is a known gap, not silently assumed solved.
- **`grade_answer({ objectiveId })`** — re-derives the answer to grade from the turn's own
  already-resolved user text (`resolved.text` in `processTurn`), never a model-supplied
  `learnerAnswer` argument — the same "server re-checks... rather than trusting model arguments"
  rule `.claude/rules/tenancy.md` states for `record_progress`, applied here too since the
  primary tutoring model could otherwise self-report a pass. Makes one small, separate
  `llm.chat()` judge call (same provider factory, no new provider config) with a structured
  prompt: the objective's `gradingCriteria` + the learner's answer, asking for
  `PASS`/`RETRY` + one-sentence feedback. Result kept in turn-scoped state (not yet persisted)
  and returned to the model as the tool result.
- **`record_progress({ objectiveId })`** — requires a `grade_answer` result for that
  `objectiveId` already computed earlier in the SAME turn (else tool-error result — the model
  cannot record a verdict it never actually got graded for). Upserts `ObjectiveProgress`
  (`attempts` incremented on conflict), sends `checkpoint.result` to the client.
- **`end_module()`** — checks every `Objective` in the curriculum has a `PASS`
  `ObjectiveProgress` for this learner; if not, returns a tool-error result naming the remaining
  objectives (lets the model keep teaching); if so, sends `module.completed`.

**New `packages/shared/src/realtime/ws-messages.ts` server messages** (per `.claude/rules/realtime.md`
— wire shapes live in this file, never hand-typed inline):

```ts
export const checkpointStartedMessageSchema = z.object({
  type: z.literal("checkpoint.started"),
  objectiveId: z.string(),
  objectiveTitle: z.string(),
});

export const checkpointResultMessageSchema = z.object({
  type: z.literal("checkpoint.result"),
  objectiveId: z.string(),
  verdict: z.enum(["PASS", "RETRY"]),
  feedback: z.string(),
  attempts: z.number().int().positive(),
});

export const moduleCompletedMessageSchema = z.object({
  type: z.literal("module.completed"),
  curriculumId: z.string(),
});
```

Added to `serverMessageSchema`'s discriminated union.

**`system-prompt.ts` gains curriculum context.** New `appendCurriculumContext(systemPrompt,
objectives)`, parallel to the existing `appendKnowledgeContext`: when `Avatar.curriculum` exists,
injects the ordered objective list (id, title, teachingContent, checkQuestion) and tool-use
instructions (call `start_checkpoint` before checking an objective, `grade_answer` after the
learner answers, `record_progress` once graded, `end_module` when all are passed) into the
per-session system prompt built at `session.start`. When no curriculum is attached, behavior is
unchanged — the existing generic "offer a short quiz" instruction in `buildSystemPrompt` stays as
the fallback.

**Latency.** Any diff to `conversation-service.ts` requires `pnpm bench:latency` output and a
`latency-auditor` review first, per `.claude/rules/realtime.md`. The tool loop only ever adds work
after `start_checkpoint` fires (rare, avatar-decided) — a turn with no tool calls is unaffected.

---

## Files to Modify

- `packages/shared/src/providers/types.ts` — `LLMProvider`/`LLMMessage`/`LLMChatOptions`, new
  `LLMToolDefinition`/`LLMStreamEvent`
- `packages/shared/src/providers/llm-gemini.ts`, `llm-groq.ts`, `llm-failover.ts` (+ their
  `.test.ts` files)
- `packages/shared/src/realtime/ws-messages.ts` — three new server message schemas
- `packages/shared/src/tutor/system-prompt.ts` — `appendCurriculumContext`
- `prisma/schema.prisma` — `Curriculum`, `Objective`, `ObjectiveProgress`,
  `ObjectiveProgressVerdict`, relation fields on `Organization`/`Avatar`/`User`
- `apps/api/src/services/conversation-service.ts` — tool dispatch loop, four tool handlers
- `apps/api/src/app.ts` — register `curriculum.ts` routes
- `apps/dashboard/app/sessions/[trainingSessionId]/useConversationSession.ts`,
  `TranscriptPanel.tsx` — handle the three new server message types

## Files to Create

- `prisma/migrations/<ts>_add_interactive_assessment/migration.sql`
- `prisma/migrations/<ts>_interactive_assessment_rls/migration.sql`
- `packages/shared/src/curriculum/schema.ts` — Zod contracts for `Curriculum`/`Objective`/API
  request-response shapes
- `packages/shared/src/curriculum/tools.ts` — the four `LLMToolDefinition`s (hand-written JSON
  Schema) shared between the LLM adapters and `conversation-service.ts`
- `packages/shared/src/curriculum/index.ts` — barrel, exported as the new `./curriculum` subpath
  in `packages/shared/package.json`
- `apps/api/src/routes/curriculum.ts`, `curriculum.test.ts`
- `apps/api/src/services/curriculum-service.ts`, `curriculum-service.test.ts` — CRUD + the
  answer-grading judge call
- `apps/dashboard/app/(dashboard)/curriculum/page.tsx`, `CurriculumEditor.tsx`,
  `ObjectiveList.tsx`, `ObjectiveRow.tsx`, `ProgressTable.tsx`, `page.module.css` (+ matching
  `.test.tsx` files, following `app/(dashboard)/knowledge/`'s file layout)
- `apps/dashboard/app/sessions/[trainingSessionId]/CheckpointFeedback.tsx` (+ test)
- `apps/dashboard/lib/api-client.ts` additions — typed wrappers for the five curriculum endpoints

---

## Dependencies

```
No new dependencies. Tool JSON Schemas are hand-written (only 4 tools) rather than adding
zod-to-json-schema.
```

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY` (n/a here — Gemini/Groq keys, same existing rule)
- Maintain tenant isolation using `org_id`
- Keep provider-specific logic inside adapters
- Validate APIs with Zod
- Preserve the public embed SDK contract
- Keep realtime latency low — run `latency-auditor` before this PR, per `.claude/rules/realtime.md`
- Use strict TypeScript
- Never use `any`
- Prefer modifying existing code
- Run `pnpm verify`
- Update documentation when public APIs change
- `record_progress`/`grade_answer` are `serverOnly` — never accept a verdict, grade, or progress
  data as a tool argument from the model (`.claude/rules/tenancy.md`)
- New endpoints need a two-org isolation test asserting cross-tenant reads return zero rows
  (`.claude/rules/tenancy.md`)

---

## Testing

- **Unit** — tool-loop dispatch (bounded round-trips, timeout → tool-error result, not turn
  failure), `grade_answer`'s judge-prompt construction, `record_progress`'s "no prior grade in
  this turn" rejection, `end_module`'s all-objectives-passed check, Gemini/Groq adapters' tool
  request/response mapping (mock fetch, mirroring existing `llm-gemini.test.ts`/`llm-groq.test.ts`
  patterns), curriculum-service CRUD + the `PUT .../objectives` diff-by-id logic.
- **Integration** — `apps/api` route tests for all five curriculum endpoints (OWNER-gated,
  404/409 cases), a full WS conversation test that drives a `session.start` → tool-call turn →
  `checkpoint.started`/`checkpoint.result` sequence against a fake `LLMProvider` that emits
  scripted `tool_call` events (matching `conversation-service.test.ts`'s existing fake-provider
  injection pattern).
- **Two-org isolation test** — org A cannot read/grade against org B's `Curriculum`/`Objective`,
  per `.claude/rules/tenancy.md`.
- **End-to-End** — manual: author a 2-objective curriculum in the dashboard, run a rehearsal
  session, answer correctly and incorrectly, confirm `RETRY` triggers remediation (not just
  "incorrect") and a `PASS` on retry records progress; confirm `module.completed` fires only
  after both objectives pass.
- **Realtime** — `pnpm bench:latency` before/after; confirm a turn with no tool calls is
  unaffected and a `grade_answer` round trip stays within the 3s per-tool timeout.
- **Manual Verification** — cross-tenant: org A's dashboard cannot see org B's curricula or
  progress even with a guessed `curriculumId`.

---

## Definition of Done

- Feature works end-to-end (author → teach → checkpoint → grade → record → complete)
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained (`pnpm bench:latency`, `latency-auditor` reviewed)
- No security regressions (`grade_answer`/`record_progress` remain `serverOnly`; RLS on all three
  new tables; two-org isolation test passes)
