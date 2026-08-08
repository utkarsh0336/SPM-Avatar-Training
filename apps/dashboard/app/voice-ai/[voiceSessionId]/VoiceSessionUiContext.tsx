"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Language } from "@avatrain/shared/tutor";

// UI toggle state only, mirrors sessions/[trainingSessionId]/TrainingSessionContext.tsx —
// deliberately separate from conversation phase, which useVoiceConversationSession.ts
// owns. No cameraOff here (voice-only, no camera control); muted and paused are
// tracked separately because the reference screenshot shows them as two distinct
// controls (Mute, Pause) even though both currently gate the same mic track.
// language is typed as the real Language enum (not a bare string) because,
// unlike video-chat's ControlBar, this one IS wired to the live session —
// see useVoiceConversationSession.ts.
export interface VoiceSessionUiState {
  muted: boolean;
  paused: boolean;
  panelVisible: boolean;
  language: Language;
}

interface VoiceSessionUiContextValue {
  state: VoiceSessionUiState;
  update: (patch: Partial<VoiceSessionUiState>) => void;
}

const VoiceSessionUiContext = createContext<VoiceSessionUiContextValue | null>(null);

interface VoiceSessionUiProviderProps {
  initialLanguage: Language;
  children: ReactNode;
}

export function VoiceSessionUiProvider({ initialLanguage, children }: VoiceSessionUiProviderProps) {
  const [state, setState] = useState<VoiceSessionUiState>({
    muted: false,
    paused: false,
    panelVisible: true,
    language: initialLanguage,
  });

  const value = useMemo<VoiceSessionUiContextValue>(
    () => ({
      state,
      update: (patch) => setState((prev) => ({ ...prev, ...patch })),
    }),
    [state],
  );

  return <VoiceSessionUiContext.Provider value={value}>{children}</VoiceSessionUiContext.Provider>;
}

export function useVoiceSessionUi(): VoiceSessionUiContextValue {
  const ctx = useContext(VoiceSessionUiContext);
  if (!ctx) {
    throw new Error("useVoiceSessionUi must be used within a VoiceSessionUiProvider");
  }
  return ctx;
}
