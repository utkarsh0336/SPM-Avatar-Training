# Spec: Authentication

## Overview

Trainer/admin authentication for the Avatrain dashboard. A trainer signs up (creating a new
`Organization` and becoming its `OWNER`), logs in with email + password, and can invite other
trainers into the org as `MEMBER`s. `apps/api` exposes the auth endpoints and a Fastify auth
middleware; `apps/dashboard` proxies to it and gates its authenticated routes behind a session
cookie.

This is trainer/dashboard authentication only. It is explicitly **not** the Phase-4 embed/widget
learner-identity JWT (`.claude/rules/embed.md`) — that stays scoped to its own future spec, per
`docs/ROADMAP.md`'s sequential-phase rule. It is also not billing (Phase 7) or SSO/enterprise IdP.

---

## Business Goal

Trainers need an account to own their organization's content, curriculum, and analytics before any
of Phase 5 (Trainer surface) can exist. Without this, there is no way to scope `Application`s,
uploads, or dashboard access to a tenant by anything other than a bare `org_id` in the URL. This
spec is the identity foundation every later trainer-facing feature (content upload, curriculum
builder, analytics, key rotation) depends on.

---

## Depends On

None. (Builds directly on the existing `Organization`/`Application` tenant model and `withOrg` RLS
wrapper from Phase 0.)

---

## Components Affected

- apps/api
- apps/dashboard
- packages/shared

---

## API Changes

All new, under `/v1/auth`. Error body shape: `{ "error": "<code>", "message"?: string }`.

| Method & path | Auth | Body | Success | Notes |
|---|---|---|---|---|
| `POST /v1/auth/signup` | none | `{ orgName, email, password }` | `201 { user, org, role: "OWNER" }` + `Set-Cookie` | Creates Organization + User + Membership(OWNER) + Session atomically. 409 on duplicate email. |
| `POST /v1/auth/login` | none | `{ email, password }` | `200 { user, org, role }` + `Set-Cookie` | Generic `401 { error: "invalid_credentials" }` for wrong password, unknown email, or zero memberships — never distinguish which. Rate-limited per email+IP. |
| `POST /v1/auth/logout` | optional cookie | — | `200 { ok: true }` always | Idempotent: deletes the matching `Session` row if any, clears cookie unconditionally, never leaks whether a session existed. |
| `GET /v1/auth/me` | required | — | `200 { user, org, role }` | 401 if no/invalid/expired session. |
| `POST /v1/auth/invite` | required, `OWNER` only | `{ email }` | `201 { inviteUrl }` | 409 if a `User` already exists for that email. No email delivery in v1 — the one-time invite URL is returned directly for the owner to relay out of band. |
| `POST /v1/auth/accept-invite` | none | `{ token, password }` | `200 { user, org, role }` + `Set-Cookie` | 400/410 if token invalid/expired/already used. Sets password, flips `User.status` to `ACTIVE`, logs in. |
| `GET /v1/auth/members` | required, `OWNER` only | — | `200 { members: [{ userId, email, role, joinedAt }] }` | Never selects `passwordHash`. Concrete surface for the required two-org isolation test. |

---

## Database Changes

Add to `prisma/schema.prisma`:

**New enums**: `Role` (`OWNER`, `MEMBER`), `UserStatus` (`ACTIVE`, `PENDING`).

**`User`** — global identity root, **not** tenant-scoped (credentials aren't tenant business data,
same reasoning as `Organization` itself):
- `id` (uuid, pk)
- `email` (unique, lowercased at the Zod layer before every read/write — no `citext` extension)
- `passwordHash` (nullable — null until an invite is accepted)
- `status` (`UserStatus`, default `ACTIVE`)
- `inviteTokenHash` (unique, nullable)
- `inviteTokenExpiresAt` (nullable)
- `createdAt`, `updatedAt`

**`Membership`** — tenant-scoped (`org_id` + RLS):
- `id` (uuid, pk), `orgId`, `userId`, `role` (`Role`, default `MEMBER`), `createdAt`
- `@@unique([orgId, userId])`, `@@index([userId])`
- No app-enforced "one org per user" DB constraint (kept future-proof), but v1 product logic treats
  it as 0-or-1: signup always creates a fresh org, and invite only succeeds for emails with no
  existing `User` row. A multi-org picker is an explicit non-goal (see below).

**`Session`** — tenant-scoped (`org_id` + RLS):
- `id` (uuid, pk), `orgId`, `userId`, `tokenHash` (unique), `userAgent` (nullable), `createdAt`,
  `lastUsedAt`, `expiresAt`
- `@@index([userId])`
- Opaque random token (32 bytes, base64url) in an httpOnly cookie; only the SHA-256 hash is
  persisted. Postgres-backed rather than a signed JWT — gives real revocability (logout deletes the
  row) with no new signing dependency.

**Migrations** (two, matching the existing style in `prisma/migrations/`):

1. `prisma migrate dev` generated `CREATE TABLE` migration for `users`, `memberships`, `sessions`.
2. Hand-written RLS migration, mirroring `prisma/migrations/20260805073229_enable_rls/migration.sql`:

```sql
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "memberships"
  USING (
    org_id = current_setting('app.current_org_id', true)::uuid
    OR user_id = current_setting('app.current_user_id', true)::uuid
  );

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "sessions"
  USING (
    org_id = current_setting('app.current_org_id', true)::uuid
    OR user_id = current_setting('app.current_user_id', true)::uuid
    OR token_hash = current_setting('app.session_lookup_hash', true)
  );
```

These use `current_setting(name, true)` (missing_ok) — unlike the existing `applications` policy —
because login must resolve org membership *before* an org context exists; the policies must
tolerate partial context (only `app.current_user_id` set, no org yet) without erroring.

**`scripts/verify-rls.mjs`**: add `"users"` to `EXEMPT_TABLES`, with a comment mirroring the
existing `organizations` justification. This is a deliberate, reviewable change to the enforcement
script itself — call it out explicitly in the PR for `security-reviewer`.

---

## UI Changes

**Dashboard** (`apps/dashboard`) — new routes:
- `/login`, `/signup`, `/accept-invite` (reads `?token=`)
- `(dashboard)` route group with a Server Component `layout.tsx` that calls `GET /v1/auth/me`
  (forwarding cookies server-to-server) and redirects to `/login` on 401; renders an authenticated
  shell (org name, logout) otherwise.
- The existing `app/page.tsx` stub **moves** under `(dashboard)/` and becomes the authenticated
  home. The outer `app/layout.tsx` (HTML shell) is unchanged and still wraps the unauthenticated
  routes too.
- `middleware.ts` — presence-only cookie check for a fast redirect; explicitly a UX nicety, not a
  security boundary (the authoritative check is `apps/api`'s `authenticate` preHandler).

No changes to Widget, Avatar, or Analytics UI — out of scope.

---

## Realtime Changes

No realtime changes.

---

## Files to Modify

- `prisma/schema.prisma`
- `scripts/verify-rls.mjs`
- `packages/shared/src/index.ts`
- `packages/shared/package.json`
- `apps/api/src/app.ts`
- `apps/api/package.json`
- `apps/dashboard/app/layout.tsx` (no content change expected, confirm it still wraps everything correctly after the route-group move)
- `apps/dashboard/app/page.tsx` → moves to `apps/dashboard/app/(dashboard)/page.tsx`
- `apps/dashboard/app/page.test.tsx` → moves to `apps/dashboard/app/(dashboard)/page.test.tsx`
- `apps/dashboard/package.json`

---

## Files to Create

- `prisma/migrations/<timestamp>_add_auth_tables/migration.sql` (generated)
- `prisma/migrations/<timestamp>_auth_rls/migration.sql` (hand-written)
- `packages/shared/src/db/with-auth.ts`
- `packages/shared/src/auth/password.ts`
- `packages/shared/src/auth/tokens.ts`
- `packages/shared/src/auth/schemas.ts`
- `apps/api/src/lib/cookies.ts`
- `apps/api/src/lib/http-errors.ts`
- `apps/api/src/lib/rate-limit.ts`
- `apps/api/src/plugins/auth.ts`
- `apps/api/src/services/auth-service.ts`
- `apps/api/src/routes/auth.ts`
- `apps/dashboard/app/api/[...path]/route.ts`
- `apps/dashboard/app/login/page.tsx`
- `apps/dashboard/app/signup/page.tsx`
- `apps/dashboard/app/accept-invite/page.tsx`
- `apps/dashboard/app/(dashboard)/layout.tsx`
- `apps/dashboard/middleware.ts`
- `apps/dashboard/lib/api-client.ts`
- `apps/dashboard/lib/server-api.ts`

---

## Dependencies

**One new dependency, needs explicit user approval**: `@node-rs/argon2` (added to
`packages/shared/package.json`), for argon2id password hashing.

- Preferred over the `argon2` npm package (node-gyp native addon) because napi-rs prebuilt binaries
  have broader platform coverage (including Alpine/musl) without a C toolchain in the deploy image.
- Safe with native bindings here because hashing happens only in `apps/api`, a persistent stateless
  Fastify process (`docs/ARCHITECTURE.md` §5), never in `apps/dashboard`'s Next.js runtime.
- Fallback if the eventual deploy target can't support native NAPI bindings: `bcryptjs` (pure JS,
  slower, weaker than argon2id, but zero deployment risk) — revisit once a concrete deploy target is
  chosen.
- Verify the current latest stable version on npm before pinning.

Everything else (cookies, tokens, error envelope, rate limiting) is hand-rolled — no other new
dependencies.

`apps/api/package.json` and `apps/dashboard/package.json` each add
`"@avatrain/shared": "workspace:*"` — first cross-package consumption in the repo, not an external
dependency.

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

- `withOrg` stays untouched — every existing/future business-data query keeps using it exactly as
  today. `withAuthContext` is a sibling, not a replacement.
- Role is always read fresh from the `Membership` table on every authenticated request — never
  trusted from a client-supplied value or cached in the session row.
- Login and invite-acceptance failures are indistinguishable by response shape (never reveal whether
  an email exists).
- No secrets or session tokens ever logged (raw token exists only in the `Set-Cookie` header and the
  one-time invite-URL response; only its hash is persisted).
- `security-reviewer` must be invoked on this diff before it's considered done — required by
  `.claude/rules/tenancy.md` for any diff touching auth or token minting.

---

## Testing

**Unit** (`packages/shared`):
- Password hash/verify round-trip; wrong password rejected; hash never equals plaintext.
- Token generation uniqueness/length; hashing determinism.
- Schema validation: weak password rejected, invalid email rejected, email lowercased.
- `withAuthContext` SQL-injection guard on each optional field, mirroring `with-org.ts`'s existing
  implicit contract.

**Integration Tests** (`apps/api/src/routes/auth.test.ts`, using `app.inject` like the existing
`app.test.ts`):
- Signup creates org+user+membership+session and sets cookie; rejects duplicate email.
- Login succeeds with correct credentials; identical 401 shape for wrong password vs. unknown email.
- Logout is idempotent; subsequent `/me` returns 401.
- `/me` returns 401 without a cookie, 200 with a valid one.
- Invite: 403 for a `MEMBER` caller (RBAC), 201 for `OWNER`, 409 for an already-registered email.
- Accept-invite sets password, flips status to `ACTIVE`, logs in.
- **Two-org isolation test** (required by `.claude/rules/tenancy.md`): org A owner's session hitting
  `GET /v1/auth/members` returns only org A's members even after org B has members seeded.

**End-to-End Tests**:
- Full flow through the dashboard proxy: sign up → redirected to authenticated home → log out →
  redirected to `/login` → hitting `/` again redirects.
- Owner invites a trainer, the invite link is used in a private window to set a password and log in
  as `MEMBER`; `MEMBER` gets 403 from the invite endpoint.

**Realtime Tests**: not applicable — no realtime changes in this spec.

**Latency Benchmarks**: not applicable — dashboard auth traffic is outside
`.claude/rules/realtime.md`'s scope (`packages/realtime-core`, `apps/agent`,
`apps/widget/src/session/**`). No `pnpm bench:latency` run required for this diff.

**RLS-level isolation test** (`packages/shared`, DB layer, independent of application code): seed
two orgs with memberships directly; prove `withOrg(orgA, ...)` returns zero rows from org B's
memberships, and `withAuthContext({ userId: userInOrgA })` self-lookup only sees its own row.

**Manual Verification**:
- `pnpm db:migrate` runs clean; `node scripts/verify-rls.mjs` (part of `pnpm verify`) passes for
  `memberships`/`sessions` and shows `users` as an intentional exemption.
- Sign up via `/signup`; confirm redirect to the authenticated home; confirm the cookie is
  `HttpOnly` (not readable from `document.cookie` in DevTools).
- Log out → redirected to `/login`; `/` afterward redirects again.
- Wrong password and nonexistent email produce the same visible error message.
- Owner invites a new trainer, opens the returned link in a private window, sets a password, logs
  in as `MEMBER`; confirms `MEMBER` gets 403 from the invite endpoint.
- Inspect the DB (`pnpm db:studio`) — `password_hash` is never plaintext; `sessions.token_hash` does
  not match the browser's actual cookie value.
- `pnpm dev` end to end: dashboard and api on separate ports, log in through the UI, confirm in the
  network tab the browser only ever calls the dashboard's own origin (no CORS errors).
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
- Latency budget maintained (n/a for this spec — no realtime-path changes)
- No security regressions

---

## Explicit Non-Goals (follow-ups, not silently dropped)

- Password reset ("forgot password") — needs email-delivery infrastructure and its own dependency
  approval (e.g. Resend/Postmark).
- Real invite-email delivery — same reason; v1 relays the invite link manually via the API response.
- Remove-member / role-change endpoints — membership revocation mid-session is still handled safely
  (auth middleware re-checks `Membership` every request and kills the session if it's gone), just no
  UI/endpoint to trigger it yet.
- Multi-org membership + an org picker at login — data model supports it, product flow doesn't
  enable it in v1.
- Redis-backed distributed rate limiting — correct fix once `apps/api` runs more than one replica;
  not requested now to avoid a second dependency ask beyond `@node-rs/argon2`.
- `packages/embed`, `packages/shared/src/contracts`, and the Phase-4 learner-identity JWT are
  untouched, per the scope boundary agreed with the user.
