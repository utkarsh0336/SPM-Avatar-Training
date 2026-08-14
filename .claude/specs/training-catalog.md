# Spec: Training Catalog

## Overview

Adds `ProgramType` as a real, queryable classification on `Curriculum` — `EMPLOYEE_ONBOARDING`,
`COMPLIANCE_TRAINING`, `CUSTOMER_EDUCATION`, `PARTNER_ENABLEMENT` — so a curriculum's audience is a
structured field instead of something only implied by its title text.

This is SOW §3.4 ("Training & Learning Management Module"), specifically the piece
`.claude/specs/interactive-assessment.md`'s Scope decisions explicitly deferred: *"SOW §3.4
separately describes employee onboarding, compliance training, customer education, and partner
enablement as distinct program types with their own categorization. None of that content-taxonomy/
audience-targeting layer is built here... audience/program-type tagging [is] deferred to a
follow-up Training Catalog spec."* This is that spec.

### Scope decisions

- **Additive nullable field, not a new model.** Mirrors `KnowledgeDocument.category`/`tags`
  (`.claude/specs/knowledge-management.md`), not a `Curriculum`-per-audience-type table split.
  Existing curricula keep working with `programType: null` ("uncategorized") — no backfill
  required, no breaking change to `POST /v1/curricula` callers who omit it.
- **One `programType` per `Curriculum`, not per-`Objective`.** Objectives stay simple teachable
  units; audience targeting is a whole-curriculum property — a trainer already builds "the
  onboarding avatar" and "the partner-enablement avatar" as separate `Avatar`+`Curriculum` pairs
  today, so tagging the curriculum is sufficient and matches how the data is actually authored.
- **No new dashboard catalog view.** No cross-avatar browsable grid, no search-by-programType UI.
  This spec exposes the field for authoring (create/edit) and display only. A dedicated catalog
  page is a plausible follow-up, deliberately deferred rather than built speculatively.
- **No RBAC visibility rules tied to `programType`.** Gating who can *see* `PARTNER_ENABLEMENT`
  content is `.claude/specs/partner-role.md`'s job, which depends on this field existing first.
  This spec only adds the field — every route stays exactly as OWNER-gated as it is today.
- **No relationship to an induction checklist.** That concept is
  `.claude/specs/induction-checklist.md`, a separate spec, deliberately independent of this one.

---

## Business Goal

SOW §3.4 requires the platform to distinguish employee onboarding, compliance training, customer
education, and partner enablement as distinct program types. Today a trainer can only tell
curricula apart by reading the title — there is no structured way to filter "show me all
compliance training," no field for a future analytics view to break completion down by audience,
and nothing for `.claude/specs/partner-role.md` to gate visibility on. This is the smallest schema
change that makes program type a real, queryable attribute rather than a naming convention.

---

## Depends On

- `.claude/specs/interactive-assessment.md` (the `Curriculum`/`Objective` model this extends)
- `.claude/specs/knowledge-management.md` (the `category`/`tags` precedent this mirrors)

---

## Components Affected

- apps/api
- apps/dashboard
- packages/shared

---

## API Changes

| Method & path | Auth | Change |
|---|---|---|
| `POST /v1/curricula` | `OWNER` | Body gains optional `programType?: ProgramType`. Omitted ⇒ `null`, unchanged from today's behavior. |
| `PATCH /v1/curricula/:curriculumId` (**new**) | `OWNER` | `{ title?: string; programType?: ProgramType \| null }`, at least one field required (400 otherwise). Returns the updated `CurriculumResult`. No such update endpoint exists today — only create/delete and the objectives replace-all. |
| `GET /v1/curricula/:curriculumId` | `OWNER` | Response (`CurriculumResult`) gains `programType`. |
| `GET /v1/avatars`, `GET /v1/avatars/all` | `OWNER` | `AvatarSummary` (`packages/shared/src/curriculum/schema.ts:103-109`) gains `programType: ProgramType \| null` alongside the existing `curriculumId`, so the dashboard's avatar picker can show/filter by it without a second request. |

---

## Database Changes

Add to `prisma/schema.prisma`:

**New enum**:
```prisma
enum ProgramType {
  EMPLOYEE_ONBOARDING
  COMPLIANCE_TRAINING
  CUSTOMER_EDUCATION
  PARTNER_ENABLEMENT
}
```

**`Curriculum`** (existing model, `prisma/schema.prisma:435-450`) gains:
- `programType ProgramType? @map("program_type")` — nullable, additive, same convention as
  `Avatar.ageGroup`/`Avatar.region` (see the `AgeGroup`/`AvatarRegion` doc comments already in the
  schema).
- `@@index([orgId, programType])` — the lookup `.claude/specs/partner-role.md` will need
  (`WHERE org_id = ? AND program_type = 'PARTNER_ENABLEMENT'`).

One generated migration (`prisma migrate dev`). No RLS changes — `Curriculum`'s existing RLS policy
already covers the new nullable column.

---

## UI Changes

**Dashboard** (`apps/dashboard/app/(dashboard)/curriculum/CurriculumEditor.tsx`):
- A program-type `<select>` next to the title field, offering the four enum values plus
  "Uncategorized" (maps to `null`) — visually mirrors `DocumentMetadataEditor.tsx`'s category
  picker on the Knowledge page.
- Included in both the create call (`createCurriculum`) and the new update call (`updateCurriculum`,
  wired to the new `PATCH` endpoint) so an existing curriculum's classification can be changed after
  creation.
- The avatar-picker list (`selectedAvatarId` dropdown, fed by `listActiveAvatars`) shows the
  program type as a small label next to each avatar's name.

No changes to Widget, Avatar rendering, or Analytics.

---

## Realtime Changes

No realtime changes.

---

## Files to Modify

- `prisma/schema.prisma`
- `packages/shared/src/curriculum/schema.ts` — new `programTypeSchema`, extend
  `curriculumSchema`/`createCurriculumRequestSchema`/`avatarSummarySchema`, new
  `updateCurriculumRequestSchema`
- `packages/shared/src/curriculum/index.ts` — re-export the new schema/type
- `apps/api/src/routes/curriculum.ts` — add the `PATCH` route
- `apps/api/src/services/curriculum-service.ts` — extend `createCurriculum`/`toCurriculumResult`,
  add `updateCurriculum`
- `apps/api/src/services/avatar-service.ts:30` — include `programType` alongside the existing
  `curriculumId` assembly
- `apps/dashboard/app/(dashboard)/curriculum/CurriculumEditor.tsx`
- `apps/dashboard/lib/api-client.ts` — add `updateCurriculum`, extend existing calls' types

---

## Files to Create

- `prisma/migrations/<timestamp>_add_curriculum_program_type/migration.sql` (generated)

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

- `programType` is redefined as a Zod enum in `packages/shared` rather than imported from
  `@prisma/client`, matching `objectiveProgressVerdictSchema`'s existing convention (keeps
  `packages/shared` browser-bundleable).
- `PATCH /v1/curricula/:curriculumId` reuses the existing `requireRole("OWNER")` gate — no RBAC
  changes here, that's `.claude/specs/partner-role.md`.

---

## Testing

**Unit** (`packages/shared`):
- `programTypeSchema` accepts all four values, rejects an arbitrary string.
- `updateCurriculumRequestSchema` rejects an empty-object body (400 "at least one field required").

**Integration Tests** (`apps/api/src/routes/curriculum.test.ts`):
- `POST /v1/curricula` without `programType` still succeeds and returns `programType: null`
  (no regression).
- `POST /v1/curricula` with each of the four `programType` values persists correctly.
- `PATCH /v1/curricula/:curriculumId` updates `title` only, `programType` only, and both together;
  400 on an empty body; 404 for a curriculum in another org.
- `GET /v1/avatars` response includes `programType` per avatar summary.

**End-to-End Tests**:
- Trainer creates a curriculum, sets its program type to `PARTNER_ENABLEMENT` via the dashboard
  select, reloads the page, confirms the selection persisted.

**Realtime Tests**: not applicable — no realtime changes.

**Latency Benchmarks**: not applicable — dashboard authoring traffic, outside
`.claude/rules/realtime.md`'s scope.

**Manual Verification**:
- `pnpm db:migrate` runs clean.
- Create a curriculum with no program type, confirm it still displays as "Uncategorized" and
  functions identically to pre-existing curricula.
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
