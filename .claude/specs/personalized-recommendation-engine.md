# Spec: Personalized Recommendation Engine

## Overview

SOW §3.5 ("Interactive Learning & Assessment") lists three bullets: adaptive learning paths,
personalized recommendations, training effectiveness measurement. The first and third are built
(`.claude/specs/adaptive-learning-paths.md`, `.claude/specs/training-effectiveness-measurement.md`).
"Personalized recommendations" is the remaining bullet, and it is a different shape of problem than
its two shipped siblings: `adaptive-learning-personalization.md` and `adaptive-learning-paths.md`
both operate *inside* a single curriculum, once a learner is already in a session, deciding how an
objective is taught or in what order. Neither touches the question that has to be answered *before*
a session starts: which of the org's several avatars/curricula should this specific learner engage
with next. That question currently has no personalized answer anywhere in the product — the org's
one existing avatar-picker surface (`apps/dashboard/app/sessions/NewSessionModal.tsx`, "Persona")
lists avatars in flat `createdAt desc` order with no signal about a learner's own history on any of
them. This spec closes that gap with a new `GET /v1/avatars/recommended` endpoint that ranks the
org's avatars for the calling learner by their own `ObjectiveProgress` history, and wires it into
that picker.

It also closes a latent access gap uncovered while tracing this: **no route today lets a plain
`MEMBER` list the org's avatars at all.** `GET /v1/avatars` and `GET /v1/avatars/all` are
`OWNER`-only; `GET /v1/avatars/mine` is scoped to `createdById: userId`, so a `MEMBER` who never
created an avatar (avatar creation is `OWNER`-only — see `avatar-service.ts`'s `createAvatar`) always
gets an empty list back from it; `GET /v1/curricula` (`.claude/specs/partner-role.md`) is
`OWNER`/`PARTNER`-only. `NewSessionModal.tsx` calls `getMyAvatars()` today, so in a multi-avatar org a
`MEMBER`-role learner's picker silently never renders (`myAvatars.length > 1` never true for them)
and every session they start falls back to whatever `resolvePersona(undefined)` defaults to,
regardless of which persona/curriculum would actually be relevant to them. The new endpoint is the
first read surface a `MEMBER` gets over the org's own avatar catalog.

### Scope decisions

- **Tier-based ranking, not a scoring model.** Same restraint `.claude/specs/adaptive-learning-paths.md`
  already committed to for within-curriculum ordering ("no per-objective score from attempt count,
  recency..."; "a numeric weighting scheme here would be exactly \[an inference engine\], just
  smaller") and `.claude/specs/adaptive-learning-personalization.md` ruled out before that ("This
  spec does not build a model that infers a learner's reading level or knowledge state"). This spec
  follows the same line: five explainable tiers, stable-sorted, computed from data the product
  already collects (`ObjectiveProgress`) — no new inference, no new signal source, no ML.
- **Cross-curriculum, avatar-centric — the half those two specs deliberately left unbuilt.** They
  answer "how should *this* curriculum teach *this* learner." This spec answers "which curriculum
  should this learner be pointed at next," across every avatar the org has. It does not re-open or
  duplicate either spec's logic; it aggregates the same underlying `ObjectiveProgress` rows to a
  coarser, per-curriculum granularity for a different question.
- **"Continue" outranks "new."** Tier order is `NEEDS_REVIEW` → `IN_PROGRESS` → `NOT_STARTED` →
  `COMPLETED` (`NO_CURRICULUM` avatars sort last, see below) — a learner already partway through a
  curriculum, especially one with a struggling objective, is surfaced ahead of an untouched one. This
  is a product judgment call, not a derived fact; documented here so it can be revisited deliberately
  rather than silently, same as `adaptive-learning-paths.md`'s own tier-order rationale.
- **Avatars without a curriculum stay selectable, just unranked.** `Curriculum.avatarId` is optional
  from the `Avatar` side (`avatar Curriculum?`) — a persona can exist for open Q&A with no structured
  objectives at all. Today's `getMyAvatars()`-backed picker lists those too. Dropping them from a new
  curriculum-only endpoint would be a regression, so `GET /v1/avatars/recommended` stays avatar-scoped
  (like `listActiveAvatars`), not curriculum-scoped (like `listCurricula`), and tags a curriculum-less
  avatar `NO_CURRICULUM` — included, sorted last, no personalized claim made about it because there's
  no progress data to make one from.
- **`PARTNER` visibility mirrors `listCurricula` exactly.** `.claude/specs/partner-role.md` already
  established the rule "a `PARTNER` sees only `PARTNER_ENABLEMENT`-tagged content"; this spec's query
  applies the identical filter (`role === "PARTNER"` narrows to avatars whose curriculum is
  `PARTNER_ENABLEMENT`) rather than inventing a second visibility rule for the same role.
- **No new dashboard page.** Same restraint `.claude/specs/training-catalog.md` used ("No new
  dashboard catalog view... deliberately deferred rather than built speculatively"). This spec wires
  personalization into the one persona-selection surface that already exists
  (`NewSessionModal.tsx`) instead of building a browsable catalog page nothing has asked for yet.
- **Dashboard-only; no embed/widget or realtime path touched.** `apps/dashboard/app/sessions` is the
  internal "AI Avatar Hub" (rehearsal/internal-employee training), cookie-authenticated via
  `app.authenticate`, unrelated to `apps/widget`'s embed flow or `conversation-service.ts`'s
  `session.start` handler. Unsigned/embed identity never calls `/v1/avatars/*` routes at all, so this
  feature has no anonymous-session case to handle, unlike the two specs it sits beside.

---

## Business Goal

SOW §3.5's "Personalized recommendations" bullet is the one item in that list with no spec and no
implementation (`docs/ROADMAP.md` Phase 5's "analytics" exit criterion covers effectiveness
measurement, not this). Without it, a learner in an org with more than one avatar has no
personalized reason to pick any particular one — the picker is alphabetical-by-recency, identical
for every learner regardless of what they've already passed, are struggling on, or haven't touched.
That undercuts the same "personalized training" pitch
`.claude/specs/adaptive-learning-personalization.md`'s Business Goal already invoked for the
in-session half of this problem; this spec is the pre-session half. It also happens to fix a real
product bug surfaced while researching it: a plain `MEMBER` — the actual "employee learner" role
this whole platform exists to train — currently cannot list the org's avatars through any endpoint,
so the picker they'd need this feature to rank never even renders for them today.

---

## Depends On

- `.claude/specs/interactive-assessment.md` — `Curriculum`/`Objective`/`ObjectiveProgress` models and
  the `PASS`/`RETRY` verdict this spec's tier computation reads.
- `.claude/specs/training-catalog.md` — `Curriculum.programType`, reused unchanged in the response
  shape (mirrors `avatarSummarySchema`'s existing `programType` field).
- `.claude/specs/partner-role.md` — the `Role` enum (`OWNER`/`MEMBER`/`PARTNER`), `requireAnyRole`
  precedent, and the exact `PARTNER` → `PARTNER_ENABLEMENT`-only visibility rule this spec's query
  reapplies verbatim.
- `.claude/specs/adaptive-learning-paths.md` — the `MASTERY_TIER`-style stable-sort-by-tier pattern
  this spec's `RECOMMENDATION_TIER` ranking follows.

---

## Components Affected

- `apps/api`
- `apps/dashboard`
- `packages/shared`

---

## API Changes

| Method & path | Auth | Change |
|---|---|---|
| `GET /v1/avatars/recommended` (**new**) | Any authenticated org member (`app.authenticate` only — `OWNER`, `MEMBER`, `PARTNER` all allowed) | Every `ACTIVE` avatar in the org (`PARTNER` narrowed to avatars whose curriculum is `PARTNER_ENABLEMENT`, same rule as `GET /v1/curricula`), each annotated with the **calling learner's own** progress signal and sorted by recommendation tier. Response: `{ avatars: RecommendedAvatar[] }` — see Database Changes' query shape below for field derivation. |

No changes to any existing endpoint (`GET /v1/avatars`, `/mine`, `/all`, `/v1/curricula`,
`/v1/curricula/:id/*` are all untouched — this is a new, additive read path, not a redefinition of
any of them).

```
No changes to /v1/conversations/* or /v1/embed/* routes — this feature does not touch session
bootstrap or the conversation-service.ts tool-call path at all.
```

---

## Database Changes

```
No database changes. This is a new read-time aggregation over already-persisted, already-RLS'd
tables (Avatar, Curriculum, Objective, ObjectiveProgress) — no new column, no new table, no
migration. Same posture as .claude/specs/training-effectiveness-measurement.md.
```

Query shape (`apps/api/src/services/avatar-service.ts`, new `getRecommendedAvatars`):

```ts
export type AvatarRecommendationTier =
  | "NEEDS_REVIEW"   // at least one objective this learner RETRY'd
  | "IN_PROGRESS"    // attempted, no RETRY outstanding, not all PASSed yet
  | "NOT_STARTED"    // has a Curriculum, learner has zero ObjectiveProgress rows on it
  | "COMPLETED"       // every objective PASSed
  | "NO_CURRICULUM"; // avatar has no Curriculum at all — nothing to rank

const RECOMMENDATION_TIER: Record<AvatarRecommendationTier, number> = {
  NEEDS_REVIEW: 0,
  IN_PROGRESS: 1,
  NOT_STARTED: 2,
  COMPLETED: 3,
  NO_CURRICULUM: 4,
};

export async function getRecommendedAvatars(
  orgId: string,
  learnerId: string,
  role: Role,
): Promise<RecommendedAvatar[]> {
  return withOrg(orgId, async (tx) => {
    const avatars = await tx.avatar.findMany({
      where: {
        orgId,
        status: "ACTIVE",
        ...(role === "PARTNER" ? { curriculum: { programType: "PARTNER_ENABLEMENT" } } : {}),
      },
      include: {
        curriculum: {
          include: { objectives: { include: { progress: { where: { learnerId } } } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return avatars
      .map((avatar) => toRecommendedAvatar(avatar)) // computes tier + counts, see below
      .sort((a, b) => RECOMMENDATION_TIER[a.recommendationTier] - RECOMMENDATION_TIER[b.recommendationTier]);
  });
}
```

Per-avatar tier derivation (`toRecommendedAvatar`), over that avatar's `curriculum.objectives`, each
carrying at most one `progress` row for `learnerId` (guaranteed by `@@unique([objectiveId,
learnerId])`):

- No `curriculum` → `NO_CURRICULUM`, `objectiveCount: 0`, `completedObjectiveCount: 0`.
- `retryCount = objectives.filter(o => o.progress[0]?.verdict === "RETRY").length` — `> 0` →
  `NEEDS_REVIEW`.
- Else `attemptedCount = objectives.filter(o => o.progress.length > 0).length` — `=== 0` →
  `NOT_STARTED`.
- Else `passedCount = objectives.filter(o => o.progress[0]?.verdict === "PASS").length` —
  `=== objectives.length` → `COMPLETED`; otherwise → `IN_PROGRESS`.

`Array.prototype.sort` is stable (ES2019+), so within a tier avatars keep their `createdAt desc`
order — same convention as `adaptive-learning-paths.md`'s `MASTERY_TIER` sort. No division anywhere
in this computation (only count comparisons), so there is no zero-denominator case to guard against.

---

## UI Changes

**Dashboard — `apps/dashboard/app/sessions/NewSessionModal.tsx`.** The existing "Persona" `<select>`
(shown when there is more than one selectable avatar) switches its data source from `getMyAvatars()`
(avatars *I created*) to the new `getRecommendedAvatars()` (every avatar available to *me as a
learner*, ranked). Concretely:

- Visibility condition becomes `avatars.length > 1` (was `myAvatars.length > 1`) — an org where only
  one avatar is visible to this caller still sees no picker, same "no behavior change for the common
  single-persona case" intent the original code already stated.
- Default `avatarId` becomes the first (top-ranked) item, replacing the old
  `active?.id ?? result.avatars[0]?.id` fallback — every returned avatar is already `ACTIVE`-filtered
  server-side, so that status disambiguation is no longer needed client-side.
- Each `<option>` gains a short suffix reflecting `recommendationTier`: "— Needs review" /
  "— Continue" / "— New" for `IN_PROGRESS` / (nothing for `NOT_STARTED`, it's the unmarked default
  framing) / "— Completed". `NO_CURRICULUM` avatars keep their current unlabeled appearance.
- The failure path is unchanged: a fetch error leaves the picker hidden and
  `useConversationSession.ts` falls back to its own default persona resolution exactly as today —
  that fallback (`getMyAvatars().then(r => r.avatars[0])` when no `avatarId` was ever set) is not
  modified by this spec.

```
No new pages, no new dashboard route. No changes to the Curriculum admin page, Settings, Analytics,
or the Widget/embed UI.
```

---

## Realtime Changes

```
No realtime changes. GET /v1/avatars/recommended is a plain dashboard GET computed from
already-persisted rows, evaluated once when NewSessionModal opens — not on the
conversation-service.ts tool-call path, not on session.start. .claude/rules/realtime.md's
pnpm bench:latency / latency-auditor requirement does not apply, same as
training-effectiveness-measurement.md's equivalent endpoint.
```

---

## Files to Modify

- `packages/shared/src/curriculum/schema.ts` — `avatarRecommendationTierSchema`,
  `recommendedAvatarSchema` (superset of the existing `avatarSummarySchema` shape plus
  `recommendationTier`/`objectiveCount`/`completedObjectiveCount`),
  `listRecommendedAvatarsResponseSchema`
- `apps/api/src/services/avatar-service.ts` — new `getRecommendedAvatars(orgId, learnerId, role)`,
  `toRecommendedAvatar` helper
- `apps/api/src/routes/avatars.ts` — new `GET /v1/avatars/recommended` route, registered before the
  parametric `:avatarId` route alongside `mine`/`all`
- `apps/api/src/routes/avatars.test.ts` — new endpoint's auth/tier/sort/PARTNER-filter/two-org cases
- `apps/dashboard/lib/api-client.ts` — new `getRecommendedAvatars()` wrapper (same shape as the
  existing `listActiveAvatars`/`getMyAvatars` wrappers)
- `apps/dashboard/app/sessions/NewSessionModal.tsx` — data source swap, default selection, per-option
  tier label
- `apps/dashboard/app/sessions/NewSessionModal.module.css` — minor style for the tier-label suffix

## Files to Create

```
None. Every change above is additive to an existing file — no new tables, no new route file, no new
dashboard page or component.
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
- Never expose `OPENAI_API_KEY` (n/a — no provider changes)
- Maintain tenant isolation using `org_id` — the new query stays inside `withOrg`, same as every
  other avatar-service.ts function
- Keep provider-specific logic inside adapters
- Validate APIs with Zod — new response schema lives in `packages/shared`
- Preserve the public embed SDK contract — no `packages/embed` or `apps/widget` changes
- Keep realtime latency low — n/a, this endpoint is not on the realtime path (see Realtime Changes)
- Use strict TypeScript; never `any`
- Prefer modifying existing code over new files
- Run `pnpm verify`
- Update documentation when public APIs change

Additional rules specific to this spec:

- `learnerId` is always `request.authContext!.userId` — never accepted from a query parameter or
  request body. A caller can only ever get *their own* recommendations, never another user's,
  mirroring `.claude/rules/tenancy.md`'s "server re-checks entitlement rather than trusting
  client-supplied arguments" principle.
- The `PARTNER` → `PARTNER_ENABLEMENT`-only filter happens inside `getRecommendedAvatars`
  (service layer), never in the route handler and never trusted from a client-supplied filter — same
  convention `partner-role.md` established for `listCurricula`.
- This endpoint only reads `ObjectiveProgress`; it adds no new write path.
  `record_progress`/`grade_answer` remain `serverOnly` and unmodified.

---

## Testing

- **Unit** (`avatar-service.ts`, exercised via `avatars.test.ts` — this codebase has no standalone
  `avatar-service.test.ts` file; existing convention tests this service through route integration
  tests only): tier derivation for an avatar with a `RETRY`'d objective → `NEEDS_REVIEW` even if
  other objectives are `PASS`ed; zero progress rows → `NOT_STARTED`; all `PASS` → `COMPLETED`; mixed
  attempted/unattempted with no `RETRY` → `IN_PROGRESS`; no `Curriculum` → `NO_CURRICULUM`; stable
  sort keeps `createdAt desc` order within a tier.
- **Integration** (`apps/api/src/routes/avatars.test.ts`): `OWNER` and `MEMBER` both get 200 with
  identical visibility rules (no `programType` narrowing); `PARTNER` sees only avatars whose
  curriculum is `PARTNER_ENABLEMENT`; unauthenticated request → 401; two learners in the same org
  with different `ObjectiveProgress` histories on the same avatar get different `recommendationTier`
  values for it (proves `learnerId` scoping, not just `orgId` scoping).
- **Two-org isolation** — required by `.claude/rules/tenancy.md`: a learner's request never returns
  an avatar from another org, and their tier computation never reads another org's
  `ObjectiveProgress` rows even via a guessed `avatarId`-adjacent query (structurally guaranteed by
  `withOrg`; assert it directly).
- **End-to-End (manual)** — as one learner: `PASS` every objective on curriculum A, `RETRY` one
  objective on curriculum B, never touch curriculum C. Open "Start a new video chat" and confirm the
  Persona picker orders B ("Needs review") above C ("New" / unmarked) above A ("Completed"). Confirm
  a `MEMBER`-role teammate who has created zero avatars themselves now sees this same ranked picker
  (previously: picker never rendered for them at all).
- **Realtime** — not applicable; not on the audio/tool-call path.
- **Manual Verification** — a `PARTNER` account confirms they see only `PARTNER_ENABLEMENT`-tagged
  avatars in the picker, matching `.claude/specs/partner-role.md`'s existing Curriculum-page
  behavior; `pnpm verify` green.

---

## Definition of Done

- Feature works end-to-end (a returning learner's persona picker visibly ranks toward what they're
  struggling on or mid-way through, ahead of untouched or already-completed content; a `MEMBER` who
  never created an avatar now sees the org's catalog at all, which they could not before)
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained (n/a — no realtime-path changes)
- No security regressions (`learnerId` always server-derived from `authContext`, never
  client-supplied; `PARTNER` visibility narrowed identically to the existing `listCurricula`
  precedent; two-org isolation test passes; no new write path)
