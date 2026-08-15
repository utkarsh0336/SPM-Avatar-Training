"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// UI toggle state only — deliberately separate from conversation phase, which in a
// real (Milestone 3+) implementation is owned by packages/realtime-core's
// session-machine, not this context. See .claude/specs/video-chat-session.md
// State Management: "UI toggles must never be modeled as machine states."
export interface TrainingSessionUiState {
  muted: boolean;
  cameraOff: boolean;
  panelVisible: boolean;
}

const INITIAL_STATE: TrainingSessionUiState = {
  muted: false,
  cameraOff: false,
  panelVisible: true,
};

interface TrainingSessionContextValue {
  state: TrainingSessionUiState;
  update: (patch: Partial<TrainingSessionUiState>) => void;
}

const TrainingSessionContext = createContext<TrainingSessionContextValue | null>(null);

export function TrainingSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TrainingSessionUiState>(INITIAL_STATE);

  const value = useMemo<TrainingSessionContextValue>(
    () => ({
      state,
      update: (patch) => setState((prev) => ({ ...prev, ...patch })),
    }),
    [state],
  );

  return <TrainingSessionContext.Provider value={value}>{children}</TrainingSessionContext.Provider>;
}

export function useTrainingSessionUi(): TrainingSessionContextValue {
  const ctx = useContext(TrainingSessionContext);
  if (!ctx) {
    throw new Error("useTrainingSessionUi must be used within a TrainingSessionProvider");
  }
  return ctx;
}
