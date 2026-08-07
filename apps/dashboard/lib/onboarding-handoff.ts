import { onboardingHandoffSchema, type OnboardingHandoff } from "@avatrain/shared/tutor";
import type { OnboardingState } from "../app/onboarding/types.js";

const STORAGE_KEY = "avatrain:onboarding-handoff";

export interface OnboardingHandoffStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// typeof window check (never a bare `window` reference) so this resolves to
// null rather than throwing under Node's vitest environment, which has no
// DOM globals configured for this project — see onboarding-handoff.test.ts.
function defaultStorage(): OnboardingHandoffStorage | null {
  return typeof window !== "undefined" ? window.localStorage : null;
}

/**
 * The wizard's final step navigates to "/" afterward, and OnboardingContext
 * is plain component-tree-scoped React state — lost on that navigation.
 * This is the client-side-only handoff that survives it (no backend/DB
 * work is in scope here). skinTone/hairStyle/hairColor are deliberately
 * dropped — presentation-only per brief §6, not consumed by the session.
 */
export function writeOnboardingAvatarHandoff(state: OnboardingState, storage?: OnboardingHandoffStorage): void {
  if (!state.style) return; // step 1 was never completed — nothing coherent to hand off
  const payload: OnboardingHandoff = {
    style: state.style,
    gender: state.gender,
    outfit: state.outfit,
    name: state.name,
    expertise: state.expertise,
    voice: state.voice,
  };
  try {
    (storage ?? defaultStorage())?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage can throw (private browsing, quota, disabled) — losing
    // the handoff just means the session falls back to a default persona.
  }
}

/** Falls back to null (not a thrown error) on missing/corrupt/invalid data — the session hook supplies its own default persona in that case. */
export function readOnboardingAvatarHandoff(storage?: OnboardingHandoffStorage): OnboardingHandoff | null {
  try {
    const raw = (storage ?? defaultStorage())?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = onboardingHandoffSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
