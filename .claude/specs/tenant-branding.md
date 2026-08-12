# Spec: Tenant Branding

## Overview

Lets an OWNER customize their organization's display name, logo, and two brand accent colors, and
replaces today's hardcoded `"SPM MEDICARE AI"` chrome in `apps/dashboard` with those real
per-tenant values. This is the first workstream of the SOW reconciliation plan's Phase A slice —
it has no dependencies and unblocks `admin-portal` (the branding form becomes one of that portal's
pages).

Explicitly out of scope: the Sidebar's `"AI Nancy"` persona-name card is driven by the active
`Avatar` record, not org branding — it stays untouched here and belongs to a later
personas/admin-portal workstream. Object/file storage for logo uploads is also out of scope; the
logo is a plain URL field (the org pastes a URL to an already-hosted image), consistent with how
`avatarSnapshotUrl`/`avatarModelUrl` already work in the `Avatar` model — a real upload endpoint is
a `knowledge-ingestion` concern (object storage is called out as an open decision there), not this
spec's.

---

## Business Goal

The SOW's SaaS Platform Requirements (§4) call for "tenant-specific branding" as a core
multi-tenant capability. Today every organization sees the identical hardcoded workspace label and
persona chrome regardless of who signed up — there is no way for a customer to see their own name
in the product. This blocks any real multi-tenant pilot or demo where more than one organization
needs to look like itself.

---

## Depends On

None

---

## Components Affected

- apps/api
- apps/dashboard
- packages/shared

---

## API Changes

- **Extend the `org` object** returned by every endpoint that returns one — `GET /v1/auth/me`,
  `POST /v1/auth/signup`, `POST /v1/auth/login`, `POST /v1/auth/google/callback`,
  `POST /v1/auth/accept-invite` (all built from `SessionResult`/`MeResult` in
  `apps/api/src/services/auth-service.ts`) — with `logoUrl: string | null`,
  `primaryColorHex: string | null`, `secondaryColorHex: string | null`. `name` is already present
  and unchanged in shape.
- **New: `PATCH /v1/org/branding`** — `preHandler: [app.authenticate, requireRole("OWNER")]`,
  mirroring the existing `PATCH /v1/auth/invite`/`/v1/auth/members` OWNER-gated pattern. Body
  validated by a new `orgBrandingUpdateSchema` (all fields optional/partial: `name`, `logoUrl`,
  `primaryColorHex`, `secondaryColorHex`). Returns the updated org in the same shape as `/me`'s
  `org`. A non-OWNER caller gets 403, matching `requireRole`'s existing behavior.

---

## Database Changes

Additive migration on the existing `organizations` table only:

```sql
ALTER TABLE "organizations" ADD COLUMN "logo_url" TEXT;
ALTER TABLE "organizations" ADD COLUMN "primary_color_hex" TEXT;
ALTER TABLE "organizations" ADD COLUMN "secondary_color_hex" TEXT;
```

`organizations` is on `scripts/verify-rls.mjs`'s `EXEMPT_TABLES` allowlist (it's the tenant root,
not tenant-scoped business data — see the model's own doc-comment in `schema.prisma`). This is a
single plain migration, **not** the paired `add_X`/`X_rls` two-migration pattern tenant-scoped
tables require (e.g. `20260808050550_add_avatars` + `20260808050600_avatars_rls`) — no RLS policy
is needed or expected here, and `verify-rls.mjs` will not flag its absence.

No new tables.

---

## UI Changes

**Dashboard:**
- New `apps/dashboard/app/(dashboard)/settings/page.tsx` (OWNER-only): a branding form — name,
  logo URL, two color inputs (with swatch preview), save button calling `PATCH /v1/org/branding`.
  Reads initial values from `getMe()` (`apps/dashboard/lib/server-api.ts`, already the auth gate
  for this route group). A MEMBER hitting this route directly is redirected — mirror the pattern
  `(dashboard)/layout.tsx` already uses to redirect an unauthenticated user to `/login`, redirecting
  a non-OWNER to `/` instead.
- `apps/dashboard/app/sessions/Sidebar.tsx` and `apps/dashboard/app/onboarding/Sidebar.tsx`:
  replace the hardcoded `"SPM MEDICARE AI"` workspace label (`Sidebar.tsx:50`,
  `onboarding/Sidebar.tsx:20`) with the real `org.name`, passed down from each route's server
  layout (`(dashboard)/layout.tsx`, `sessions/layout.tsx`, `onboarding/layout.tsx`,
  `voice-ai/layout.tsx` — whichever independently call `getMe()` today). When `org.logoUrl` is set,
  render it as a small image ahead of the name; otherwise keep the text-only look.
- Same layouts: when `org.primaryColorHex`/`secondaryColorHex` are set, apply them as inline CSS
  custom-property overrides on the tokens root wrapper via a shared `orgAccentStyle()` helper
  (`apps/dashboard/lib/org-theme.ts`). Corrected during implementation: `--vc-accent-violet`/
  `--vc-accent-blue` are **not** consumed by `Sidebar.module.css` itself, but are consumed widely
  elsewhere (`(dashboard)/page.module.css`, the `voice-ai`/`sessions/[trainingSessionId]` session
  UIs). More importantly, `--vc-accent-gradient` (and onboarding's `--ob-accent-*` equivalents) are
  their **own independently hardcoded** variables in every `tokens.module.css`, not composed from
  the violet/blue vars via CSS — so the helper computes and overrides the gradient explicitly too,
  or every gradient-background element would silently ignore the org's colors. Unset fields (or an
  org with no branding at all) emit no override, so the existing hardcoded defaults apply unchanged.
- Wire the Sidebar's existing no-op gear-icon button (`Sidebar.tsx:123`, `aria-label="Settings"`)
  to navigate to `/settings` — it already has the right label and icon, just no handler.
- No changes to the "AI Nancy" persona card, `apps/widget`, avatar rendering, or analytics.

---

## Realtime Changes

No realtime changes.

---

## Files to Modify

- `prisma/schema.prisma` — add `logoUrl`, `primaryColorHex`, `secondaryColorHex` to `Organization`
- `apps/api/src/app.ts` — register the new org routes
- `apps/api/src/services/auth-service.ts` — extend `SessionResult`/`MeResult`'s `org` type and all
  5 construction sites (`signup`, `login`, `me`, `acceptInvite`, `loginWithGoogle`)
- `apps/dashboard/lib/api-client.ts` — extend `AuthOrg` with the 3 new optional fields (flows
  through to `server-api.ts`'s `MeResult` automatically, since it reuses `AuthOrg`)
- `apps/dashboard/app/sessions/Sidebar.tsx`
- `apps/dashboard/app/onboarding/Sidebar.tsx`
- `apps/dashboard/app/(dashboard)/layout.tsx`
- `apps/dashboard/app/sessions/layout.tsx`
- `apps/dashboard/app/onboarding/layout.tsx`
- `apps/dashboard/app/voice-ai/layout.tsx`
- `packages/shared/package.json` — add a `"./org"` subpath export mirroring the existing
  `"./onboarding"` entry

---

## Files to Create

- `packages/shared/src/org/schema.ts` — `orgBrandingUpdateSchema` (partial: `name`, `logoUrl` as
  `z.string().url()`, `primaryColorHex`/`secondaryColorHex` as `/^#[0-9A-Fa-f]{6}$/`-validated hex
  strings), all optional
- `packages/shared/src/org/index.ts` — barrel (`export * from "./schema.js"`), same shape as
  `packages/shared/src/onboarding/index.ts`
- `packages/shared/src/org/schema.test.ts`
- `apps/api/src/routes/org.ts` — `registerOrgRoutes(app)`, the `PATCH /v1/org/branding` handler
- `apps/api/src/routes/org.test.ts`
- `apps/api/src/services/org-service.ts` — `updateBranding(orgId, input)`, a plain
  `prisma.organization.update` (no `withOrg` wrapper needed — `organizations` is RLS-exempt, same
  as `auth-service.ts`'s existing `me()` doing a direct `prisma.organization.findUniqueOrThrow`)
- `apps/api/src/services/org-service.test.ts`
- `apps/dashboard/app/(dashboard)/settings/page.tsx`
- `apps/dashboard/app/(dashboard)/settings/BrandingForm.tsx`
- `apps/dashboard/app/(dashboard)/settings/page.module.css`
- `apps/api/src/lib/org-result.ts` — added during implementation: the org-row-to-`OrgBrandingResult`
  mapping is identical in `auth-service.ts` (5 sites) and `org-service.ts`, so it's factored into
  one shared helper instead of duplicated
- `apps/dashboard/lib/org-theme.ts` — added during implementation: `orgAccentStyle()`, the shared
  CSS-custom-property-override computation described above, used by all 4 layouts

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

Specific to this feature:
- Import the new org schema via the `@avatrain/shared/org` subpath, never the root
  `@avatrain/shared` barrel, from any browser-bundled file (`apps/dashboard/lib/*`) — the root
  barrel re-exports server-only modules (argon2, echogarden) that webpack cannot bundle, exactly
  the reason `onboarding` already uses a subpath export.
- `PATCH /v1/org/branding` must re-derive `orgId` from `request.authContext`, never from the
  request body — an OWNER can only ever brand their own org.
- Color/URL fields are optional everywhere (nullable in the DB, optional in the Zod schema) — an
  org that never sets branding must render identically to today, not break.

---

## Testing

- **Unit Tests**: `org/schema.test.ts` — accepts valid hex colors and URLs, rejects malformed ones
  (mirror `onboarding/schema.test.ts`'s style); `org-service.test.ts` — `updateBranding` persists
  only the provided fields, leaves others untouched.
- **Integration Tests**: `org.test.ts` — `"PATCH /v1/org/branding — two-org isolation"`: a
  MEMBER caller gets 403, an OWNER caller gets 200 and the update is visible on a subsequent
  `GET /v1/auth/me`, and org B's OWNER can never affect org A's branding (mirror
  `auth.test.ts`'s existing `"GET /v1/auth/members — two-org isolation"` block).
- **End-to-End Tests**: none required for this UI-only change beyond the integration coverage
  above; a manual pass covers the form.
- **Realtime Tests**: No realtime changes.
- **Latency Benchmarks**: Not applicable — no changes to `conversation-service.ts` or the realtime
  path.
- **Manual Verification**: sign up a fresh org, confirm the Sidebar shows the default look; set a
  name/logo/colors via `/settings`; confirm the Sidebar (both `sessions` and `onboarding` variants)
  and the accent gradient reflect the change; confirm a MEMBER account cannot reach `/settings` or
  call the PATCH endpoint.

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
