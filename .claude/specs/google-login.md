# Spec: Google Login

## Overview

Adds "Sign in with Google" to the existing trainer/admin dashboard login page, using the standard
OAuth 2.0 Authorization Code flow with PKCE. A verified Google identity either logs into an
existing `User` (linking by verified email if not already linked), or — for a never-seen-before
email — self-serve creates a new `Organization` + `User(OWNER)` + `Membership`, exactly mirroring
`POST /v1/auth/signup`'s existing semantics. After either path, the browser lands on `/onboarding/1`
if the user hasn't completed onboarding yet, or `/` otherwise — this same check is added to the
existing password-login path too, closing a pre-existing gap where onboarding was never triggered
at all.

This is trainer/dashboard authentication only, extending `.claude/specs/authentication.md`. It
does not implement onboarding's own backend (Avatar model, draft/complete endpoints) — see
Explicit Non-Goals.

---

## Business Goal

Removes password friction from the "Enterprise secure login" flow the login page already markets
("SSO Ready" badge, inert Google/Microsoft buttons). Faster signup-to-first-avatar time also
matters because the onboarding wizard is the mandatory gate before any trainer can use the product.

---

## Depends On

- `.claude/specs/authentication.md` (email/password auth, `User`/`Membership`/`Session` model) —
  implemented, merged.
- `.claude/specs/onboarding.md` — this spec adds the one field (`User.onboardingCompletedAt`) that
  spec already designates as Authentication's to own. The rest of onboarding's backend (Avatar
  model, draft/complete endpoints) is **not** implemented by this spec.

---

## Components Affected

- apps/api
- apps/dashboard
- packages/shared

---

## API Changes

New, under `/v1/auth`, alongside the existing routes in `apps/api/src/routes/auth.ts`:

| Method & path | Auth | Body | Success | Notes |
|---|---|---|---|---|
| `POST /v1/auth/google/callback` | none | `{ code, codeVerifier }` (Zod) | `200 { user, org, role }` + `Set-Cookie` | Exchanges `code` for tokens via `google-auth-library`, verifies the ID token (signature, issuer, audience — library-handled), resolves/creates the account (see Database Changes), mints a `Session` exactly like `login`/`signup` do today. `redirectUri` is read from apps/api's own `GOOGLE_REDIRECT_URI` env var, never trusted from the request body. |

No change to `/v1/auth/me`'s response shape, but it now also returns `onboardingCompletedAt` on
`user` so the dashboard can branch on it in one call.

`GET /v1/auth/google` (authorization-URL construction) and the OAuth callback's browser-facing hop
are **not** apps/api routes — see UI Changes; they're dedicated `apps/dashboard` route handlers
that call the one API route above server-to-server. This is required because the dashboard's
generic `[...path]` proxy can't carry a redirect-based flow (see Implementation Rules).

---

## Database Changes

Add to `prisma/schema.prisma`:

```prisma
enum OAuthProvider {
  GOOGLE
}

/// Global identity root, same reasoning as User — not tenant-scoped, RLS-exempt.
/// See scripts/verify-rls.mjs EXEMPT_TABLES.
model OAuthAccount {
  id                String        @id @default(uuid()) @db.Uuid
  userId            String        @map("user_id") @db.Uuid
  provider          OAuthProvider
  providerAccountId String        @map("provider_account_id")
  email             String
  createdAt         DateTime      @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id])

  @@unique([provider, providerAccountId])
  @@index([userId])
  @@map("oauth_accounts")
}
```

Additive on `User` (the field `.claude/specs/onboarding.md` already expects Authentication to add):

```prisma
onboardingCompletedAt DateTime? @map("onboarding_completed_at")
```

**Migrations** (two, matching the existing style in `prisma/migrations/`):

1. `prisma migrate dev` generated `CREATE TABLE`/`ALTER TABLE` migration for `oauth_accounts` +
   `users.onboarding_completed_at`.
2. Hand-written RLS-exemption note mirrors `users` — `oauth_accounts` needs no RLS policy since
   it's globally identity-scoped, not tenant-scoped, but `scripts/verify-rls.mjs` must list it in
   `EXEMPT_TABLES` explicitly (a migration that adds a non-RLS'd table without that entry fails
   `pnpm verify:rls` by design).

**Account resolution logic** (new `authService.loginWithGoogle(profile)`, mirroring
`signup`/`login`'s existing transaction style in `apps/api/src/services/auth-service.ts`):

1. Look up `OAuthAccount` by `(provider: "GOOGLE", providerAccountId: profile.sub)`. Found → log
   into that `OAuthAccount.userId`'s existing org/membership (same as today's `login`).
2. Else, reject if `profile.email_verified !== true` (never auto-link an unverified email — account
   takeover risk, flag for `security-reviewer`). Otherwise look up `User` by lowercased email.
   Found → create the linking `OAuthAccount` row for that existing `User` (also flips
   `status: PENDING → ACTIVE` if the user was invited but never set a password), then log in.
3. Else → new email: create `Organization` + `User(status: ACTIVE, passwordHash: null)` +
   `Membership(role: OWNER)` + `OAuthAccount`, in one transaction, same shape as `signup()` today.

All three paths end by creating a `Session` row and returning the same `SessionResult` shape
`signup`/`login` already return — reuses `generateOpaqueToken`, `sha256Hex`, `setAuthContext`,
`serializeSessionCookie` as-is, no changes to those.

---

## UI Changes

**Dashboard** — two new dedicated Route Handlers (Node runtime, *not* part of the generic
`app/api/[...path]/route.ts` catch-all, since that proxy's server-side `fetch()` follows redirects
and collapses intermediate `Set-Cookie` headers, which breaks a redirect-based OAuth flow):

- `apps/dashboard/app/api/auth/google/route.ts` (`GET`): generates `state` + PKCE
  `codeVerifier`/`codeChallenge` (Node's built-in `crypto` — no new dependency needed for this
  half), sets short-lived (5 min) httpOnly `oauth_state`/`oauth_verifier` cookies, redirects the
  browser to Google's authorization endpoint. Uses `GOOGLE_CLIENT_ID` (public, safe in the
  dashboard's server-side env — never shipped to client JS since this runs in a Route Handler).
- `apps/dashboard/app/api/auth/google/callback/route.ts` (`GET`): validates the returned `state`
  against the `oauth_state` cookie, POSTs `{ code, codeVerifier }` to apps/api's
  `/v1/auth/google/callback` (server-to-server `fetch`, not through the generic proxy), relays the
  `Set-Cookie` it gets back onto its own response exactly like the existing catch-all proxy already
  does, clears the two `oauth_*` cookies, then redirects to `/onboarding/1` or `/` based on the
  response body's `onboardingCompletedAt`. On failure: redirect to `/login?error=oauth_failed`.

`apps/dashboard/middleware.ts`'s matcher already excludes `api/auth` from its cookie-presence
check, so these routes need no change there.

`apps/dashboard/app/login/LoginForm.tsx`: wire the existing inert Google button — becomes a plain
`<a href="/api/auth/google">` (real navigation, not a `fetch`-based `onClick`, since this must be a
full browser redirect).

**Shared post-login redirect gate** (fixes the password path too): extract the "check
`onboardingCompletedAt`, redirect to `/onboarding/1` or `/`" logic into one place used by both the
new Google callback route and the existing `LoginForm.tsx`/`SignupForm.tsx` (which currently
hardcode `window.location.assign("/")`). `login`/`signup` responses now include
`onboardingCompletedAt`, and each form's hardcoded redirect checks it instead.

No changes to Widget, Avatar, or Analytics UI — out of scope.

---

## Realtime Changes

No realtime changes.

---

## Files to Modify

- `prisma/schema.prisma`
- `scripts/verify-rls.mjs`
- `packages/shared/src/auth/schemas.ts` (add `googleCallbackSchema`; add `onboardingCompletedAt` to
  `userResponseSchema`)
- `packages/shared/src/index.ts` (export new Google adapter + schema)
- `packages/shared/package.json` (new dependency)
- `apps/api/src/routes/auth.ts` (register `POST /v1/auth/google/callback`)
- `apps/api/src/services/auth-service.ts` (add `loginWithGoogle`; add `onboardingCompletedAt` to
  `me`/`SessionResult`)
- `apps/dashboard/app/login/LoginForm.tsx` (wire the Google button; use shared redirect logic)
- `apps/dashboard/app/signup/SignupForm.tsx` (use shared redirect logic)
- `apps/dashboard/lib/api-client.ts` (`AuthResult`/`AuthUser` gain `onboardingCompletedAt`)
- `apps/dashboard/lib/server-api.ts` (`MeResult` gains `onboardingCompletedAt`)

---

## Files to Create

- `prisma/migrations/<timestamp>_add_oauth_accounts/migration.sql` (generated)
- `packages/shared/src/auth/google.ts` — `google-auth-library` adapter: `verifyGoogleIdToken`,
  `exchangeGoogleCode` (reads `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` from
  env)
- `packages/shared/src/auth/google.test.ts`
- `apps/dashboard/app/api/auth/google/route.ts`
- `apps/dashboard/app/api/auth/google/callback/route.ts`
- `apps/dashboard/lib/oauth-pkce.ts` — small PKCE/state helper (Node `crypto`, no library)

---

## Dependencies

**One new dependency, approved by user**: `google-auth-library`, added to
`packages/shared/package.json`. Used only for `OAuth2Client.getToken()` (code exchange) and
`.verifyIdToken()` (signature/issuer/audience verification via Google's JWKS, handled internally).

Everything else (PKCE generation, `state` cookies, authorization-URL construction) is hand-rolled
with Node's built-in `crypto` — no dependency added to `apps/dashboard`.

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY` — same posture applies to `GOOGLE_CLIENT_SECRET`: apps/api only,
  never in the dashboard's client bundle or browser-exposed env
- Maintain tenant isolation using `org_id`
- Keep provider-specific logic inside adapters (`packages/shared/src/auth/google.ts` is the only
  place `google-auth-library` is imported)
- Validate APIs with Zod
- Use strict TypeScript, no `any`
- Prefer modifying existing code — reuse `generateOpaqueToken`/`sha256Hex`/`setAuthContext`/
  `serializeSessionCookie`/`withAuthContext` as-is
- Run `pnpm verify`

Additional rules specific to this spec:

- `GOOGLE_REDIRECT_URI` is read server-side from env on both the dashboard (to build the
  authorization URL) and apps/api (to validate the token exchange) — duplicated by value across
  the two apps' env config, matching the existing `SESSION_COOKIE_NAME` duplication precedent in
  `apps/dashboard/middleware.ts`.
- Never auto-link an `OAuthAccount` to an existing `User` unless Google's `email_verified` claim is
  `true`.
- The dashboard's generic `app/api/[...path]/route.ts` proxy must not be reused for the OAuth
  redirect hops — its server-side `fetch()` follows redirects and collapses `Set-Cookie` headers.
- `security-reviewer` must be invoked on this diff before it's considered done — required by
  `.claude/rules/tenancy.md` for any diff touching auth or token minting.

---

## Testing

**Unit** (`packages/shared`):
- `google.ts` adapter — mock `google-auth-library`'s `OAuth2Client` to test the token-exchange/
  verify wrapper's error handling (expired/invalid token, wrong audience) without hitting Google's
  network.

**Integration Tests** (`apps/api/src/routes/auth.test.ts`):
- All three account-resolution branches (existing OAuthAccount, link-by-verified-email,
  brand-new-signup).
- Unverified-email rejection.
- PENDING→ACTIVE flip on link.
- Two-org isolation test per `.claude/rules/tenancy.md`.

**End-to-End Tests**:
- Full redirect chain through the dashboard's two new routes with a mocked Google token endpoint;
  verify session cookie lands on the dashboard's origin; verify redirect target branches correctly
  on `onboardingCompletedAt`.

**Realtime Tests**: not applicable — no realtime changes in this spec.

**Latency Benchmarks**: not applicable — dashboard auth traffic is outside
`.claude/rules/realtime.md`'s scope. No `pnpm bench:latency` run required.

**Manual Verification**:
- Real Google OAuth consent screen in dev, using a real test Google Cloud OAuth client; confirm
  redirect to `/onboarding/1` for a first-time email, cookie is `HttpOnly`.
- Log out, log back in with the same Google account — confirm no duplicate Organization/User.
- `pnpm db:migrate` runs clean; `node scripts/verify-rls.mjs` passes with `users` and
  `oauth_accounts` both listed as intentional exemptions.
- Test password login/signup — confirm they now also respect `onboardingCompletedAt`.
- `pnpm verify` green.
- `security-reviewer` agent invoked on the diff before marking this done.

---

## Definition of Done

- [ ] Feature works end-to-end (real Google account, dev environment)
- [ ] All tests pass
- [ ] `pnpm verify` passes
- [ ] No lint errors
- [ ] No TypeScript errors
- [ ] Documentation updated
- [ ] Latency budget maintained (n/a — no realtime-path changes)
- [ ] No security regressions (unverified-email linking rejected, secrets never reach the browser)

---

## Explicit Non-Goals (follow-ups, not silently dropped)

- Onboarding's own backend (`Avatar` model, `GET`/`PATCH /v1/onboarding`, `/complete`) — stays
  scoped to `.claude/specs/onboarding.md`, a separate spec/branch. This feature only adds the
  `onboardingCompletedAt` field and the redirect gate that reads it. Until that backend exists,
  `onboardingCompletedAt` never gets set by the product, so every login currently redirects to
  `/onboarding/1` — expected until the onboarding backend spec lands.
- "Continue with Microsoft" — the login page's other inert button stays inert; `OAuthProvider` is
  structured as an enum so adding `MICROSOFT` later doesn't require another identity-model
  migration, but no Microsoft work happens here.
- Redis-backed OAuth state storage — the short-lived `oauth_state`/`oauth_verifier` cookies are
  sufficient and match the existing in-memory rate-limiter's "no new infra dependency" posture
  (Redis-backed distributed rate limiting is also deferred in `authentication.md`).
- Onboarding route guards (redirecting an unauthenticated user away from `/onboarding/*`) — those
  routes have no auth check at all today; adding one is part of the separate onboarding spec, not
  this one.
- Password reset, real invite-email delivery, remove-member/role-change endpoints — unchanged
  non-goals carried over from `.claude/specs/authentication.md`.
