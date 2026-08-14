"use client";

import { useState } from "react";
import type { UiLocaleInput } from "@avatrain/shared/auth";
import { ApiError, updateMyLocale } from "../api-client";
import { useTranslation } from "./LocaleProvider";
import styles from "./LocaleSwitcher.module.css";

/**
 * A two-way toggle, not a dropdown — there are exactly two locales (see
 * .claude/specs/dashboard-localization.md's Scope decision 1), so a
 * dropdown would be one extra click for no benefit. Renders inside the
 * authenticated Sidebar's user card and persists via PATCH /v1/auth/me.
 *
 * Pre-auth pages (login/signup/accept-invite) are out of scope for this
 * pass — see the spec's Scope decision 5 for the cookie-only design a
 * follow-up pass would use there instead of this PATCH call.
 *
 * className lets each Sidebar copy fit it into its own layout without this
 * shared component owning either one's CSS module.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, t, setLocale } = useTranslation();
  const [pending, setPending] = useState(false);

  const other: UiLocaleInput = locale === "EN" ? "HI" : "EN";

  async function handleToggle(): Promise<void> {
    if (pending) return;
    const previous = locale;
    // Optimistic: flips the visible chrome immediately, then persists.
    setLocale(other);
    setPending(true);
    try {
      await updateMyLocale(other);
    } catch (err) {
      // Roll back — a failed PATCH shouldn't leave the client and
      // User.uiLocale silently out of sync (see the spec's Manual
      // Verification note on this). ApiError vs. network failure both
      // reduce to the same recovery here: just revert.
      console.error("Failed to save UI locale:", err instanceof ApiError ? err.body : err);
      setLocale(previous);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className={className ? `${styles.toggle} ${className}` : styles.toggle}
      aria-label={t("localeSwitcher.ariaLabel")}
      disabled={pending}
      onClick={() => void handleToggle()}
    >
      {locale === "EN" ? t("localeSwitcher.en") : t("localeSwitcher.hi")}
    </button>
  );
}
