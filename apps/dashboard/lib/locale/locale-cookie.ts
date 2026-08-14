/**
 * Shared between server components (via next/headers' cookies()) and the
 * client-side LocaleSwitcher (via document.cookie) — see
 * .claude/specs/dashboard-localization.md's Scope decision 5. Plain
 * (non-httpOnly): it must be readable and writable from client JS before a
 * pre-auth page has any User row to persist a preference to, and it carries
 * no sensitive data, unlike the session cookie in apps/api/src/lib/cookies.ts.
 */
export const UI_LOCALE_COOKIE_NAME = "avatrain_ui_locale";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Client-side only — reads document.cookie directly. Server Components
 * read the cookie via next/headers' cookies() instead (see
 * (dashboard)/layout.tsx and lib/server-api.ts), not this function. */
export function readLocaleCookieClient(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${UI_LOCALE_COOKIE_NAME}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/** Client-side only. Not httpOnly/Secure-flagged here since document.cookie
 * can't set httpOnly anyway; Secure is omitted so this still works over
 * plain-http local dev, matching this repo's existing session-cookie dev
 * behavior (see apps/api/src/lib/cookies.ts). */
export function writeLocaleCookieClient(value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${UI_LOCALE_COOKIE_NAME}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}
