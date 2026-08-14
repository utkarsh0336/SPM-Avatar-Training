# Spec: Partner Role

## Overview

Adds a `PARTNER` value to the `Role` enum (today `OWNER`/`MEMBER` only) and a read-only,
`programType`-scoped visibility path so an org can invite an external partner/distributor/dealer
contact who can see the curricula tagged `PARTNER_ENABLEMENT` — and nothing else. A `PARTNER` gets
none of `OWNER`'s admin power: no content creation, no member management, no access to
non-partner-enablement curricula.

This is SOW §3.4's RBAC gap: *"No partner/distributor/dealer role type — RBAC is limited to
Owner/Member."* `apps/api/src/routes/curriculum.ts:12-14`'s own code comment already flagged this
as expected future work: *"Same OWNER-only gate as knowledge.ts (content curation is admin-level
until the Role enum grows a finer tier)."* This spec is that tier.

### Scope decisions

- **`PARTNER` is read-only.** It can view `PARTNER_ENABLEMENT`-tagged curricula
  (`.claude/specs/training-catalog.md`) and, implicitly, the avatar teaching them. It cannot
  create/edit/delete curricula, upload knowledge documents, manage applications, or invite other
  members. Every existing `OWNER`-only write route stays exactly `OWNER`-only, unchanged.
- **One role, not three.** SOW's "partner/distributor/dealer" collapses into a single `PARTNER`
  role rather than one enum value per named term — the same reasoning
  `.claude/specs/training-catalog.md` used to collapse SOW's program-type list into one
  `programType` field instead of a table per audience. If distributor-vs-dealer ever need different
  permissions, that is a real future request, not something to model speculatively now.
- **New `requireAnyRole([...])` guard, additive.** The existing `requireRole(role)`
  (`apps/api/src/plugins/auth.ts:53-59`) is an exact-match single-role check and stays completely
  untouched — every current `OWNER`-only callsite keeps working exactly as today. A new sibling
  guard handles the "one of several roles" case this spec introduces.
- **Invite gains a role parameter, capped at `MEMBER`/`PARTNER`.** Never `OWNER` — preserves
  `.claude/specs/authentication.md`'s existing invariant that org ownership is never granted via
  invite, only by signing up a fresh org.
- **No partner-specific dashboard shell.** A `PARTNER` logs into the same dashboard as everyone
  else and sees the existing Curriculum page rendered read-only and pre-filtered — not a redesigned
  or separately-branded surface.
- **A minimal member-management UI is in scope, because none exists at all today.** Confirmed by
  code search: `POST /v1/auth/invite` and `GET /v1/auth/members`
  (`.claude/specs/authentication.md`) have zero callers anywhere in `apps/dashboard` — inviting
  anyone, `MEMBER` or otherwise, currently requires calling the API directly. Without a Settings →
  Members page, `PARTNER` would be unreachable from the actual product, so building that minimal
  page is part of this spec rather than a silently-assumed prerequisite.

---

## Business Goal

SOW §3.4 calls for a distinct role for external partners/distributors/dealers, separate from
internal `OWNER`/`MEMBER` trainers. Without it, the only way to give an outside partner any access
today is making them a full `MEMBER` of the org — which, per the current RBAC model, is
functionally almost as privileged as `OWNER` for anything not explicitly gated tighter, and has no
way to restrict them to only the content meant for them. This spec closes that gap with the
smallest workable role: read-only, pre-scoped to `PARTNER_ENABLEMENT` content.

---

## Depends On

- `.claude/specs/authentication.md` (the `Role` enum, `requireRole` guard, and invite flow this
  extends)
- `.claude/specs/training-catalog.md` (the `Curriculum.programType` field this gates visibility on
  — `PARTNER_ENABLEMENT` must exist as a value before it can be used as a filter)

---

## Components Affected

- apps/api
- apps/dashboard
- packages/shared

---

## API Changes

| Method & path | Auth | Change |
|---|---|---|
| `POST /v1/auth/invite` | `OWNER` | Body gains optional `role?: "MEMBER" \| "PARTNER"` (default `MEMBER`, matching today's hardcoded behavior). 400 if any other value (including `"OWNER"`) is supplied. |
| `GET /v1/curricula` (**new**) | `OWNER` or `PARTNER` | No such org-wide listing exists today (`curriculum-service.ts` only supports lookup by id or by avatar). `OWNER` gets every curriculum in the org; `PARTNER` gets only those with `programType: "PARTNER_ENABLEMENT"` — filtered server-side in `curriculum-service.ts`, never by a client-supplied filter. Response: `{ curricula: [{ id, avatarId, avatarName, title, programType, objectiveCount, createdAt, updatedAt }] }`. |
| `GET /v1/curricula/:curriculumId` | `OWNER` or `PARTNER` | `PARTNER` may now call this route. If the curriculum's `programType !== "PARTNER_ENABLEMENT"`, respond `404 curriculum_not_found` (not `403`) — a `PARTNER` must not be able to distinguish "exists but not mine" from "doesn't exist" by probing ids, mirroring the tenant-isolation "return zero rows" convention in `.claude/rules/tenancy.md`. `OWNER` behavior is unchanged. |
| `GET /v1/curricula/:curriculumId/progress` | `OWNER` or `PARTNER` | Same visibility rule as above — a partner can see aggregate progress only for curricula it can already view. |
| `GET /v1/auth/members` | `OWNER` | Unchanged — already returns `role` per member (`.claude/specs/authentication.md`'s existing response shape). |

All write routes on curricula (`POST`, `PATCH`, `PUT .../objectives`, `DELETE`) keep
`requireRole("OWNER")` exactly as today — no change.

---

## Database Changes

Add to `prisma/schema.prisma`:

**`Role`** enum (`prisma/schema.prisma:15-18`) gains a third value:
```prisma
enum Role {
  OWNER
  MEMBER
  PARTNER
}
```

No new tables, no new columns. One generated migration (`prisma migrate dev`) for the enum change.

---

## UI Changes

**Dashboard** (`apps/dashboard`):
- New `apps/dashboard/app/(dashboard)/settings/members/page.tsx` (+ `MembersPanel.tsx`) —
  `OWNER`-only: lists members and their roles (`GET /v1/auth/members`), and an invite form
  (email + role picker limited to `Member`/`Partner`) calling `POST /v1/auth/invite`, returning the
  one-time invite URL for the owner to relay, matching `.claude/specs/authentication.md`'s existing
  "no email delivery in v1" behavior.
- `apps/dashboard/app/(dashboard)/curriculum/page.tsx` — its current gate
  (`if (me.role !== "OWNER") redirect("/")`) becomes `if (me.role !== "OWNER" && me.role !==
  "PARTNER") redirect("/")`. `knowledge/page.tsx` and `settings/page.tsx` keep their existing
  `OWNER`-only gates unchanged — a `PARTNER` has no reason to reach either.
- `apps/dashboard/app/(dashboard)/curriculum/CurriculumEditor.tsx` — gains a read-only rendering
  path for `PARTNER`: the avatar picker only lists avatars whose curriculum is
  `PARTNER_ENABLEMENT`-tagged (via the new `GET /v1/curricula`), and all authoring controls
  (title/objective edit, create, delete) are hidden — a `PARTNER` sees the same objectives and
  progress table an `OWNER` would, minus every mutation control.

---

## Realtime Changes

No realtime changes.

---

## Files to Modify

- `prisma/schema.prisma`
- `apps/api/src/plugins/auth.ts` — add `requireAnyRole(roles: Role[])`, `requireRole` untouched
- `apps/api/src/services/auth-service.ts` — `invite()` (currently hardcodes `role: "MEMBER"` at
  line 224) takes a `role` parameter instead
- `apps/api/src/routes/auth.ts` — invite route body schema gains `role`
- `packages/shared/src/auth/schemas.ts` — invite request schema, `Role` type
- `apps/api/src/routes/curriculum.ts` — add the `GET /v1/curricula` list route; loosen the by-id
  and progress routes to `requireAnyRole(["OWNER", "PARTNER"])` plus an in-handler visibility check
- `apps/api/src/services/curriculum-service.ts` — add `listCurricula(orgId, role)` with the
  role-aware `programType` filter
- `apps/dashboard/app/(dashboard)/curriculum/page.tsx`
- `apps/dashboard/app/(dashboard)/curriculum/CurriculumEditor.tsx`
- `apps/dashboard/lib/api-client.ts` — add `listCurricula`, `inviteMember`, `listMembers`
- `apps/dashboard/lib/server-api.ts` — if `getMe()`'s role type needs widening

---

## Files to Create

- `prisma/migrations/<timestamp>_add_partner_role/migration.sql` (generated)
- `apps/dashboard/app/(dashboard)/settings/members/page.tsx`
- `apps/dashboard/app/(dashboard)/settings/members/MembersPanel.tsx`
- `apps/dashboard/app/(dashboard)/settings/members/MembersPanel.test.tsx`
- `apps/dashboard/app/(dashboard)/settings/members/page.module.css`

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

- Role is still always read fresh from `Membership` on every request
  (`apps/api/src/plugins/auth.ts:42-49`) — this spec does not change that; `requireAnyRole` reads
  the same `request.authContext.role` `requireRole` does.
- `PARTNER` visibility filtering happens in `curriculum-service.ts`, never in the route handler and
  never trusted from a query parameter — the same "server re-checks entitlement rather than
  trusting model/client arguments" principle `.claude/rules/tenancy.md` states for
  `record_progress`/`grade_answer`.
- `security-reviewer` must be invoked on this diff before it's considered done — required by
  `.claude/rules/tenancy.md` for any diff touching auth or role checks.

---

## Testing

**Unit** (`packages/shared`):
- Invite schema rejects `role: "OWNER"`; accepts `"MEMBER"`/`"PARTNER"`/omitted.

**Integration Tests** (`apps/api`):
- `auth.test.ts`: invite with `role: "PARTNER"` creates a `Membership` with that role; invite with
  `role: "OWNER"` → 400; accept-invite flow works identically regardless of role.
- `curriculum.test.ts`:
  - `PARTNER` caller hits any write route (`POST`/`PATCH`/`PUT objectives`/`DELETE`) → 403.
  - `PARTNER` caller hits `GET /v1/curricula` → sees only `PARTNER_ENABLEMENT`-tagged curricula
    from their own org.
  - `PARTNER` caller hits `GET /v1/curricula/:id` for a non-`PARTNER_ENABLEMENT` curriculum in
    their own org → 404 (not 403).
  - `OWNER` caller behavior on all the above routes is unchanged from before this spec.
  - `MEMBER` caller (unchanged role) still gets 403 on everything `OWNER`-gated, confirming no
    accidental privilege widening.
- Existing `avatars.ts`/`applications.ts`/`knowledge.ts`/`org.ts` `OWNER`-only tests still pass
  unmodified — proves `requireRole` itself is untouched.
- **Two-org isolation test** (required by `.claude/rules/tenancy.md`): a `PARTNER` in org A cannot
  see org B's `PARTNER_ENABLEMENT` curricula via `GET /v1/curricula`, even with a guessed id.

**End-to-End Tests**:
- Owner tags a curriculum `PARTNER_ENABLEMENT`, invites a partner via the new Settings → Members
  page with role `Partner`, the partner accepts the invite in a private window, logs in, and sees
  exactly that one curriculum read-only — no edit controls, no other org content reachable.

**Realtime Tests**: not applicable — no realtime changes.

**Latency Benchmarks**: not applicable — dashboard/auth traffic, outside
`.claude/rules/realtime.md`'s scope.

**Manual Verification**:
- `pnpm db:migrate` runs clean.
- Owner invites a `MEMBER` (unchanged flow) and a `PARTNER` (new), confirms both work end to end
  through the dashboard.
- Confirm a `PARTNER` account gets a plain 403/redirect on every page and route an `OWNER` reaches
  but a `PARTNER` shouldn't (Knowledge, Applications, Settings, Members).
- `pnpm verify` green.
- `security-reviewer` agent invoked on the diff before marking this done.

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
