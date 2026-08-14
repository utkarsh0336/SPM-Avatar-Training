# Spec: Induction Checklist

## Overview

Adds a structured, non-conversational checklist a trainer can attach to a `Curriculum` — discrete
tasks a learner checks off directly ("Read the employee handbook," "Complete IT setup," "Meet your
manager") — as a companion to, not a replacement for, the AI-avatar-led `Objective` checkpoints
`.claude/specs/interactive-assessment.md` already built.

This is SOW §3.4's gap: *"No structured onboarding checklist or induction workflow beyond the
conversational curriculum."* It is deliberately **not** named "onboarding" anywhere in its own
model or route names, to avoid colliding with `.claude/specs/onboarding.md` — that existing spec is
a trainer-facing avatar-configuration wizard ("A mandatory 6-step wizard... walks the trainer
through configuring their first Avatar"), not a learner-facing induction workflow. This spec is
about the learner's side: a checklist of real-world tasks that don't fit a graded Q&A pattern.

### Scope decisions

- **One optional `InductionChecklist` per `Curriculum`**, nullable 1:1 — mirrors `Curriculum`'s own
  1:1-per-`Avatar` shape (`prisma/schema.prisma:435-438`'s `avatarId String @unique`). Not a
  standalone org-level entity, so it inherits the parent curriculum's `programType`
  (`.claude/specs/training-catalog.md`) and avatar scoping for free instead of needing its own
  targeting logic.
- **Checklist items are self-attested, not graded.** Completion is a learner clicking "done," not
  `grade_answer`'s server-graded verdict — this spec does not reuse the `serverOnly` tool-call
  machinery `.claude/rules/tenancy.md` reserves for `record_progress`/`grade_answer`. It's a plain
  authenticated REST endpoint, with the same trust boundary `ObjectiveProgress` already uses:
  `learnerId` is always taken from the caller's own auth context, never a request body.
- **Surfaces in the dashboard rehearsal screen, not the widget.**
  `.claude/specs/interactive-assessment.md`'s own Scope decisions ("No widget UI... embeddable
  widget UI for this feature is Phase 4 territory") applies here too — the checklist widget joins
  checkpoint/grading feedback in `apps/dashboard/app/sessions/[trainingSessionId]/SidePanel.tsx`.
- **No due dates, reminders, notifications, or manager-assignment workflow.** A flat ordered list
  with a completed/not-completed state per learner — the same kind of deliberate cut
  `.claude/specs/interactive-assessment.md` made deferring a full attempt log.
- **No dependency on `.claude/specs/partner-role.md`.** A checklist's authoring visibility follows
  its parent curriculum's existing `OWNER`-only gate; if a `PARTNER_ENABLEMENT` curriculum ever
  grows a checklist, `PARTNER` read-access to it falls out automatically once that spec ships — not
  built specially here.

---

## Business Goal

SOW §3.4 asks for an induction workflow as its own concept, separate from conversational teaching —
a compliance/HR reality (sign the handbook, complete an IT ticket, attend an in-person session) that
doesn't fit a graded Q&A pattern and shouldn't be forced through an avatar conversation just to be
trackable. Without this, the only way to track a non-conversational onboarding task today is
off-platform (a spreadsheet or a separate tool), which undercuts the platform's own "tracks learning
progress" promise for exactly the tasks compliance/HR teams care most about auditing.

---

## Depends On

- `.claude/specs/interactive-assessment.md` (the `Curriculum` model this attaches to, and the
  `ObjectiveProgress` pattern this mirrors for per-learner completion tracking)

---

## Components Affected

- apps/api
- apps/dashboard
- packages/shared

---

## API Changes

All new, under `/v1`. Error body shape matches the existing convention: `{ "error": "<code>",
"message"?: string }`.

| Method & path | Auth | Body | Success | Notes |
|---|---|---|---|---|
| `POST /v1/curricula/:curriculumId/checklist` | `OWNER` | `{ title }` | `201 { id, curriculumId, title }` | 409 `checklist_exists` if this curriculum already has one — mirrors `Curriculum`'s own avatar-uniqueness 409. |
| `GET /v1/curricula/:curriculumId/checklist` | `OWNER`, or the authenticated learner in a session for this curriculum's avatar | — | `200 { id, curriculumId, title, items: [{ id, order, title, description, completed }] }` | `completed` is resolved per-caller from `ChecklistItemProgress`; 404 if no checklist exists for this curriculum. |
| `PUT /v1/curricula/:curriculumId/checklist/items` | `OWNER` | `{ items: [{ id?, title, description? }] }` | `200 { items: [...] }` | Replace-the-whole-list semantics, identical convention to `PUT /v1/curricula/:curriculumId/objectives` — `id` present updates, absent creates, array position encodes order. |
| `PATCH /v1/checklist-items/:itemId/complete` | authenticated learner | `{ completed: boolean }` | `200 { itemId, completed, completedAt }` | Upserts `ChecklistItemProgress` for the caller's own `authContext`/ticket identity only — never a body-supplied `learnerId`, same trust boundary `record_progress` uses today. |
| `DELETE /v1/curricula/:curriculumId/checklist` | `OWNER` | — | `204` | Cascade-deletes items and progress rows. |

---

## Database Changes

Add to `prisma/schema.prisma`:

**`InductionChecklist`** — tenant-scoped (`org_id` + RLS):
- `id` (uuid, pk), `orgId`, `curriculumId` (`@unique`, FK → `Curriculum`, `onDelete: Cascade`),
  `createdById`, `title`, `createdAt`, `updatedAt`
- `@@index([orgId])`

**`ChecklistItem`** — tenant-scoped:
- `id` (uuid, pk), `orgId`, `checklistId` (FK → `InductionChecklist`, `onDelete: Cascade`), `order`
  (Int), `title`, `description` (nullable), `createdAt`, `updatedAt`
- `@@unique([checklistId, order])`, `@@index([orgId])`, `@@index([checklistId])` — mirrors
  `Objective`'s shape exactly (`prisma/schema.prisma:456-476`)

**`ChecklistItemProgress`** — tenant-scoped:
- `id` (uuid, pk), `orgId`, `itemId` (FK → `ChecklistItem`, `onDelete: Cascade`), `learnerId` (FK →
  `User`), `completedAt` (nullable `DateTime` — `null` means not completed, set means completed;
  simpler than a separate boolean+timestamp pair), `createdAt`, `updatedAt`
- `@@unique([itemId, learnerId])`, `@@index([orgId])`, `@@index([learnerId])` — mirrors
  `ObjectiveProgress`'s shape (`prisma/schema.prisma:484-503`)

`Organization` gains `inductionChecklists InductionChecklist[]`,
`checklistItems ChecklistItem[]`, `checklistItemProgresses ChecklistItemProgress[]` relations,
following the pattern every other tenant-scoped model already uses there.

**Migrations**: one generated `CREATE TABLE` migration, plus a hand-written RLS migration for all
three tables, mirroring `.claude/specs/authentication.md`'s own RLS migration style.

---

## UI Changes

**Dashboard** (`apps/dashboard`):
- `apps/dashboard/app/(dashboard)/curriculum/CurriculumEditor.tsx` gains a checklist section — new
  `ChecklistEditor.tsx` (mirrors `ObjectiveList.tsx`/`ObjectiveRow.tsx`'s add/reorder/remove-then-
  save-the-whole-list pattern), rendered below the objectives list. Save wires to the replace-all
  `PUT`.
- `apps/dashboard/app/sessions/[trainingSessionId]/SidePanel.tsx` gains a checklist widget (new
  `ChecklistPanel.tsx`) — the same panel that already surfaces checkpoint/grading feedback per
  `.claude/specs/interactive-assessment.md` — showing items with checkboxes, calling the
  complete/uncomplete `PATCH` on click, optimistic-updating then reconciling with the response.

No changes to Widget, Avatar, or Analytics UI — out of scope, same reasoning
`.claude/specs/interactive-assessment.md` gave for its own UI scope.

---

## Realtime Changes

No realtime changes — checklist completion is a plain REST action outside the voice/tool-call loop,
not a new Realtime event, tool, or system-prompt addition.

---

## Files to Modify

- `prisma/schema.prisma`
- `packages/shared/src/curriculum/schema.ts` — or a new sibling file (see Files to Create) for the
  checklist schemas, re-exported from `packages/shared/src/curriculum/index.ts`
- `apps/api/src/routes/curriculum.ts` — add the checklist sub-routes (or a dedicated router
  registered alongside it, see Files to Create)
- `apps/dashboard/app/(dashboard)/curriculum/CurriculumEditor.tsx`
- `apps/dashboard/app/sessions/[trainingSessionId]/SidePanel.tsx`
- `apps/dashboard/lib/api-client.ts` — add checklist CRUD + complete-item calls

---

## Files to Create

- `prisma/migrations/<timestamp>_add_induction_checklist/migration.sql` (generated)
- `prisma/migrations/<timestamp>_induction_checklist_rls/migration.sql` (hand-written)
- `packages/shared/src/curriculum/checklist-schema.ts`
- `apps/api/src/services/checklist-service.ts`
- `apps/api/src/routes/checklist.ts` (registers the checklist sub-routes; kept separate from
  `curriculum.ts` the same way `progress` reads live alongside but distinct from curriculum
  authoring, for testability)
- `apps/api/src/routes/checklist.test.ts`
- `apps/api/src/services/checklist-service.test.ts`
- `apps/dashboard/app/(dashboard)/curriculum/ChecklistEditor.tsx`
- `apps/dashboard/app/(dashboard)/curriculum/ChecklistEditor.test.tsx`
- `apps/dashboard/app/sessions/[trainingSessionId]/ChecklistPanel.tsx`
- `apps/dashboard/app/sessions/[trainingSessionId]/ChecklistPanel.test.tsx`

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
- Preserve the public embed SDK contract
- Keep realtime latency low
- Use strict TypeScript
- Never use `any`
- Prefer modifying existing code
- Run `pnpm verify`
- Update documentation when public APIs change

Additional rules specific to this spec:

- `PATCH /v1/checklist-items/:itemId/complete` is never given a `learnerId` in its request body —
  the identity always comes from `request.authContext`, matching
  `.claude/rules/tenancy.md`'s "server re-checks entitlement rather than trusting model/client
  arguments" principle even though this endpoint isn't a model-invoked tool.
- Unsigned (anonymous) identity may never write to `ChecklistItemProgress`, same rule
  `.claude/rules/tenancy.md` states for `ObjectiveProgress` — there is no anonymous code path into
  this endpoint today, same as `.claude/specs/interactive-assessment.md` notes for its own tables.

---

## Testing

**Unit** (`packages/shared`):
- Checklist item schema validation: empty title rejected, `description` optional.

**Integration Tests** (`apps/api`):
- `checklist-service.test.ts`: create/replace-items/complete/delete round-trip; `completedAt`
  upserts correctly on repeated completes and un-completes.
- `checklist.test.ts`:
  - `OWNER` creates a checklist for a curriculum that already has one → 409.
  - Non-`OWNER` caller on any authoring route (`POST`/`PUT`/`DELETE`) → 403.
  - Learner completes an item, `GET .../checklist` reflects `completed: true` for that learner and
    `false` for a different learner on the same item.
  - `PATCH .../complete` with a body-supplied `learnerId` is ignored — the row is always keyed on
    the caller's own identity.
  - **Two-org isolation test** (required by `.claude/rules/tenancy.md`): org A's checklist/items are
    invisible to an org B caller, including via a guessed `itemId`.

**End-to-End Tests**:
- Trainer adds three checklist items to a curriculum, saves; the rehearsal screen's side panel shows
  all three unchecked; checking one off persists across a page reload.

**Realtime Tests**: not applicable — no realtime changes.

**Latency Benchmarks**: not applicable — checklist completion is outside
`.claude/rules/realtime.md`'s scope (not on the voice/audio path).

**Manual Verification**:
- `pnpm db:migrate` runs clean; `node scripts/verify-rls.mjs` (part of `pnpm verify`) passes for the
  three new tables.
- Full flow through `pnpm dev`: trainer authors a checklist, a learner in a rehearsal session checks
  items off one at a time, refreshing the page preserves state.
- `pnpm verify` green.

---

## Definition of Done

- Feature works end-to-end
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained (n/a — no realtime-path changes)
- No security regressions
