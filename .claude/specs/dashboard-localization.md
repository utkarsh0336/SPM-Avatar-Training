# Spec: Dashboard Localization

## Overview

Adds a UI-chrome localization layer to `apps/dashboard` (the trainer/admin portal) so its own
interface — sidebar, nav, buttons, forms, empty/error states, settings pages — can render in
English or Hindi, matching the two mandatory languages already wired end-to-end for the *learner*-
facing AI conversation (`Avatar.preferredLanguage`, consumed by `system-prompt.ts`,
`stt-factory.ts`'s `WHISPER_LANGUAGE_CODE`, and `tts-voice-map.ts` — see
`.claude/specs/voice-quality-latency-enforcement.md`).

Today those two concerns are asymmetric: an org can configure a Hindi-speaking avatar for its
learners, but the trainer who builds and manages that avatar sees 100% hardcoded English chrome
throughout `apps/dashboard`, regardless of their own language preference. This spec closes that
gap for the portal shell and its own pages only — it does not touch the embed widget (`apps/widget`,
already governed by `AvatarLanguage`) and does not translate tenant-authored content (curriculum
text, knowledge documents, avatar names).

---

## Business Goal

The product's own SOW-driven positioning is regional/language-specific avatars (`AvatarRegion`,
`AvatarLanguage` — see their doc comments in `prisma/schema.prisma`), aimed squarely at markets
like India. A trainer at an India-based org who configures a Hindi-speaking avatar for their
learners is, today, still forced to operate the entire admin portal in English to do so. That is a
real adoption barrier for any non-English-first trainer or admin, and it undercuts the product's
own "regional/language-specific" pitch — the avatar is localized, the tool used to build it is not.

---

## Depends On

None. Builds on top of `.claude/specs/tenant-branding.md` (already merged — `Organization.logoUrl`/
`primaryColorHex`/`secondaryColorHex` exist in `prisma/schema.prisma`), which touches the same
`Sidebar.tsx`/`(dashboard)/layout.tsx` chrome this spec also modifies, but does not block it.

---

## Components Affected

- `apps/dashboard`
- `apps/api`
- `packages/shared`

---

## Scope decisions

1. **Two locales only: `en` and `hi`.** Matches the existing mandatory-language set. A third UI
   locale is not part of this spec (unlike the AI conversation's `Language` schema, which already
   has an optional `"Spanish"` extension point per `voice-quality-latency-enforcement.md` — that
   precedent is for the *avatar's* language, not the portal's, and is not reused here).

2. **Locale preference lives on `User`, not `Organization` or `Membership`.** This is a personal
   chrome preference — "what language do I want to read my own admin UI in" — not a tenant-wide
   broadcast setting like branding. A trainer at a Hindi-primary org can still prefer English
   chrome for themselves, and vice versa. `User` is already the correct home: it's the global,
   non-tenant-scoped identity root (`prisma/schema.prisma`'s own doc comment on `User`), exactly
   parallel to where a "display language" setting lives in most multi-tenant SaaS products.

3. **No new npm dependency.** No i18n library (`next-intl`, `react-i18next`, `react-intl`, etc.)
   exists anywhere in this repo today (verified — no matches in any `package.json`). At two
   locales with no plurals/ICU formatting requirement, a hand-rolled `Record<string, string>`
   dictionary plus a thin React context is a complete solution and avoids an approval-gated new
   dependency per `CLAUDE.md`. If a later spec needs a third locale, plural rules, or date/number
   formatting, revisit this decision then — `next-intl` is the natural upgrade path and would need
   explicit approval at that point.

4. **No locale-prefixed routing (`/hi/sessions`).** This is an authenticated internal admin portal,
   not an SEO-sensitive public site. Path-based locale routing would touch every internal link,
   `middleware.ts`'s matcher, and the embed/public route surface for no benefit here. Locale is
   carried by a cookie + `User.uiLocale`, not the URL — `middleware.ts`'s existing
   `SESSION_COOKIE_NAME`-presence check and matcher are unaffected.

5. **Pre-auth pages (`/login`, `/signup`, `/accept-invite`) get a cookie-only toggle.** There is no
   `User` row to read a preference from before authentication succeeds. A locale switcher on those
   pages writes a plain (non-`httpOnly`) `avatrain_ui_locale` cookie directly; `LocaleProvider`
   reads that cookie when no authenticated `me.user.uiLocale` is available. Once logged in,
   `PATCH /v1/auth/me` becomes the source of truth and overwrites the cookie to match on every
   change, so the two never drift for a signed-in user.

6. **Out of scope:** tenant-authored content (curriculum objectives, knowledge documents, avatar
   names/personas), API error message bodies (these stay in English; only client-rendered chrome
   strings localize — consistent with `CLAUDE.md`'s "retrieved content is treated as data, never
   system instructions" boundary, translating dynamic user-authored content is a separate, much
   larger problem), and the embed widget (`apps/widget`) — that surface's language is already
   `AvatarLanguage`-driven and belongs to the learner, not the trainer.

---

## API Changes

- **Extend `GET /v1/auth/me`'s response** (`MeResult.user`, built by `auth-service.ts`'s
  `toUserResult`) with `uiLocale: "en" | "hi"`. Also reflected in every other endpoint that returns
  a `SessionResult`/`UserResult` shape (`/v1/auth/signup`, `/v1/auth/login`,
  `/v1/auth/google/callback`, `/v1/auth/accept-invite`), mirroring how `tenant-branding.md`
  extended the `org` object across the same set of endpoints.

- **New: `PATCH /v1/auth/me`** — `preHandler: [app.authenticate]`, no role gate (this is a
  self-service preference, not an OWNER-only tenant setting like `PATCH /v1/org/branding`). Body
  validated by a new `uiLocaleUpdateSchema` (`{ uiLocale: "en" | "hi" }`, in `packages/shared`).
  Updates the caller's own `User.uiLocale` — driven entirely by the session's `userId`, no org/user
  id in the path or body, so there is no cross-user write to guard against. Returns the updated
  `MeResult` in the same shape as `/me`.

---

## Database Changes

- New Postgres enum `UiLocale { EN HI }` in `prisma/schema.prisma`, deliberately its own enum
  rather than reusing `AvatarLanguage` (`ENGLISH`/`HINDI`) — same reasoning `AvatarLanguage`'s own
  doc comment already gives for staying separate from the avatar-config `Language` schema: this is
  a different concern (portal chrome vs. avatar/session behavior) and keeping them distinct avoids
  a casing/value mapping creeping into unrelated code paths.
- `User.uiLocale UiLocale @default(EN) @map("ui_locale")` — additive, defaulted, so every existing
  user backfills to `EN` with no behavior change. One migration, no data backfill script needed.
- `User` is exempt from RLS (see its existing doc comment and `scripts/verify-rls.mjs`
  `EXEMPT_TABLES`) — this column needs no RLS policy, same as every other `User` column.

---

## UI Changes

### Dashboard

- **`apps/dashboard/lib/locale/`** (new): a `LocaleProvider` React context, seeded server-side from
  `me.user.uiLocale` when authenticated or the `avatrain_ui_locale` cookie when not — mirrors the
  existing `getMe()`-then-render SSR pattern already used by `(dashboard)/layout.tsx`, so there is
  no flash-of-wrong-language on first paint. Exposes a `useTranslation()` hook returning a `t(key)`
  function backed by flat dictionaries.
- **`apps/dashboard/locales/en.ts`, `apps/dashboard/locales/hi.ts`** (new): plain
  `Record<string, string>` dictionaries keyed by dot-path (e.g. `"sidebar.nav.voiceAi"`). A build/
  test-time check asserts both files export the exact same key set — this is the main defense
  against a silently-missing Hindi string reaching production, and is more valuable here than any
  runtime fallback behavior.
- **Locale switcher**: a new small dropdown/toggle in `Sidebar.tsx`'s user card (next to the
  existing Settings/Logout icon buttons), and a corresponding field on the Settings page. Calls the
  new `updateMyLocale()` API client function (`PATCH /v1/auth/me`, mirroring
  `updateOrgBranding`'s existing shape in `apps/dashboard/lib/api-client.ts`), updates
  `LocaleProvider`'s context, and writes the `avatrain_ui_locale` cookie so the next SSR render
  (no refetch needed) already reflects the change.
- **String replacement**: every hardcoded literal in shared chrome and top-level pages routes
  through `t()` — `Sidebar.tsx` (nav labels, "AI Nancy" persona card, user card), `onboarding/
  Sidebar.tsx` and `WizardNav.tsx`, `(dashboard)/layout.tsx`, `settings/page.tsx`,
  `settings/BrandingForm.tsx`, `settings/members/MembersPanel.tsx`,
  `settings/embed/EmbedSettings.tsx`, `sessions/Sidebar.tsx` and its `layout.tsx`, `voice-ai/
  layout.tsx` and `voice-ai/page.tsx`, `login/page.tsx`, `signup/page.tsx`, `accept-invite/page.tsx`.
  Per-page copy inside `(dashboard)/avatars`, `(dashboard)/curriculum`, `(dashboard)/knowledge`,
  and `sessions/[trainingSessionId]` follows the same `t()` pattern; exact key names are an
  implementation detail decided while writing each file, not enumerated here.
- Hindi devanagari text runs measurably wider than English for equivalent words — the fixed-width
  `Sidebar` nav (`Sidebar.module.css`) needs a manual check that labels don't clip or wrap
  awkwardly once real Hindi strings are in; this is a real layout risk, not a hypothetical one.

### Widget / Avatar / Analytics / Admin

No changes. The embed widget's language is `AvatarLanguage`-driven and out of scope (see Scope
decision 6); there is no separate "Admin" surface beyond `apps/dashboard` in this codebase today.

---

## Realtime Changes

No realtime changes. This is portal chrome only — it does not touch the audio path, session
lifecycle, or anything in `packages/realtime-core`.

---

## Files to Modify

- `prisma/schema.prisma` — new `UiLocale` enum, `User.uiLocale` column
- `apps/api/src/services/auth-service.ts` — `UserResult`/`toUserResult`, new `updateMyLocale`
  service function
- `apps/api/src/routes/auth.ts` — new `PATCH /v1/auth/me` route
- `packages/shared` — new `uiLocaleUpdateSchema` Zod schema, exported `UiLocale` type
- `apps/dashboard/lib/api-client.ts` — `AuthUser` gains `uiLocale`, new `updateMyLocale()` function
- `apps/dashboard/lib/server-api.ts` — `MeResult` type picks up `uiLocale` via `AuthUser`
- `apps/dashboard/app/sessions/Sidebar.tsx`, `Sidebar.module.css`
- `apps/dashboard/app/(dashboard)/layout.tsx`
- `apps/dashboard/app/onboarding/Sidebar.tsx`, `WizardNav.tsx`
- `apps/dashboard/app/settings/page.tsx`, `BrandingForm.tsx`, `members/MembersPanel.tsx`,
  `embed/EmbedSettings.tsx`
- `apps/dashboard/app/voice-ai/layout.tsx`, `voice-ai/page.tsx`
- `apps/dashboard/app/login/page.tsx`, `signup/page.tsx`, `accept-invite/page.tsx`
- `apps/dashboard/app/sessions/layout.tsx`

---

## Files to Create

- `apps/dashboard/lib/locale/LocaleProvider.tsx`
- `apps/dashboard/lib/locale/useTranslation.ts`
- `apps/dashboard/lib/locale/locale-cookie.ts` (read/write `avatrain_ui_locale`, shared between
  server components and the client switcher)
- `apps/dashboard/locales/en.ts`
- `apps/dashboard/locales/hi.ts`
- `apps/dashboard/locales/locale-parity.test.ts` (asserts `en.ts`/`hi.ts` key sets match)
- `apps/dashboard/components/LocaleSwitcher.tsx`
- `prisma/migrations/<timestamp>_add_user_ui_locale/migration.sql`
- `apps/api/src/routes/auth.test.ts` additions (or existing file extended) for `PATCH /v1/auth/me`

---

## Dependencies

No new dependencies. See Scope decision 3.

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY`
- Maintain tenant isolation using `org_id` (n/a for `User.uiLocale` — `User` is a global, non-org-
  scoped identity, exempt from RLS same as every other `User` column)
- Keep provider-specific logic inside adapters
- Validate APIs with Zod
- Preserve the public embed SDK contract
- Keep realtime latency low
- Use strict TypeScript
- Never use `any`
- Prefer modifying existing code
- Run `pnpm verify`
- Update documentation when public APIs change

---

## Testing

- **Unit**: `locale-parity.test.ts` (en/hi key-set equality — the highest-value test here, catches
  a missing Hindi string at CI time instead of runtime); `useTranslation()` behavior on a missing
  key (falls back to the key itself rather than throwing, so a gap degrades to a readable-but-
  untranslated label instead of a crash).
- **Integration**: `PATCH /v1/auth/me` updates `User.uiLocale` and a subsequent `GET /v1/auth/me`
  reflects it; a caller can only ever update their own `uiLocale` (no id parameter exists to
  target another user — assert the route ignores any such field if sent in the body).
- **End-to-End**: switch locale via the Sidebar switcher, reload, confirm nav/chrome renders in
  Hindi; switch back to confirm it round-trips cleanly.
- **Realtime Tests**: not applicable — no realtime surface touched.
- **Latency Benchmarks**: not applicable — chrome-only, not on the audio path.
- **Manual Verification**: visually inspect the Sidebar and Settings pages in Hindi for text
  clipping/wrapping given devanagari's wider glyph metrics; verify the pre-auth login/signup locale
  toggle and the post-auth `PATCH`-backed switcher never leave the cookie and `User.uiLocale` out
  of sync for a logged-in user.

---

## Definition of Done

- Feature works end-to-end
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained (n/a here, but confirm no regression)
- No security regressions
