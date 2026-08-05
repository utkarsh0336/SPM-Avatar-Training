"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { INITIAL_ONBOARDING_STATE, type OnboardingState } from "./types";

interface OnboardingContextValue {
  state: OnboardingState;
  update: (patch: Partial<OnboardingState>) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OnboardingState>(INITIAL_ONBOARDING_STATE);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      state,
      update: (patch) => setState((prev) => ({ ...prev, ...patch })),
    }),
    [state],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return ctx;
}
