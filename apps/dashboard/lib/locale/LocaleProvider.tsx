"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { UiLocaleInput } from "@avatrain/shared/auth";
import { getTranslator, type Translator } from "./dictionaries";
import { writeLocaleCookieClient } from "./locale-cookie";

interface LocaleContextValue {
  locale: UiLocaleInput;
  t: Translator;
  setLocale: (locale: UiLocaleInput) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export interface LocaleProviderProps {
  /** Seeded server-side — see (dashboard)/layout.tsx and the pre-auth
   * layouts, both of which already resolve a locale before rendering (from
   * me.user.uiLocale or the avatrain_ui_locale cookie respectively). No
   * flash-of-wrong-language on first paint because of this. */
  initialLocale: UiLocaleInput;
  children: ReactNode;
}

/**
 * Client-side locale context for interactive chrome (Sidebar,
 * LocaleSwitcher, forms). Server Components don't need this — they call
 * dictionaries.ts's getTranslator(locale) directly with whatever locale
 * they already resolved. See .claude/specs/dashboard-localization.md.
 */
export function LocaleProvider({ initialLocale, children }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<UiLocaleInput>(initialLocale);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      t: getTranslator(locale),
      // Writes the cookie immediately so the next SSR navigation already
      // reflects the change without waiting on the PATCH /v1/auth/me
      // round trip to finish — LocaleSwitcher still awaits the request
      // itself to persist it, this just keeps the client in sync.
      setLocale: (next) => {
        setLocaleState(next);
        writeLocaleCookieClient(next);
      },
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useTranslation(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useTranslation() must be used inside a <LocaleProvider>");
  }
  return context;
}
