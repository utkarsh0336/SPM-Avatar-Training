import type { UiLocaleInput } from "@avatrain/shared/auth";
import { en, type Dictionary } from "../../locales/en";
import { hi } from "../../locales/hi";

const DICTIONARIES: Record<UiLocaleInput, Dictionary> = { EN: en, HI: hi };

export const DEFAULT_LOCALE: UiLocaleInput = "EN";

/** Anything else (missing cookie, a stale/unknown value) falls back to
 * English rather than throwing — a bad locale value should degrade the
 * chrome's language, never break the page. */
export function resolveLocale(value: string | null | undefined): UiLocaleInput {
  return value === "HI" ? "HI" : DEFAULT_LOCALE;
}

function getByPath(dictionary: Dictionary, path: string): string | undefined {
  const value = path.split(".").reduce<unknown>((node, segment) => {
    return typeof node === "object" && node !== null ? (node as Record<string, unknown>)[segment] : undefined;
  }, dictionary);
  return typeof value === "string" ? value : undefined;
}

/**
 * Server-safe translator: no React, so it works equally in Server
 * Components (settings/page.tsx) and Client Components (via
 * LocaleProvider's useTranslation() hook, which wraps this). `key` is a
 * dot-path into the dictionary tree (e.g. "settingsPage.title"). A missing
 * key falls back to the key itself — a visible-but-readable gap instead of
 * a crash — and is a bug the locale-parity test should already be catching.
 */
export function getTranslator(locale: UiLocaleInput) {
  const dictionary = DICTIONARIES[locale];
  return function t(key: string, params?: Record<string, string>): string {
    const template = getByPath(dictionary, key) ?? key;
    if (!params) return template;
    return Object.entries(params).reduce(
      (result, [name, value]) => result.replaceAll(`{${name}}`, value),
      template,
    );
  };
}

export type Translator = ReturnType<typeof getTranslator>;
