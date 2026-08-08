"use client";

import { createContext, useContext, useRef, type ReactNode, type RefObject } from "react";
import type { ConversationSessionStatus } from "@avatrain/realtime-core";
import type { Language } from "@avatrain/shared/tutor";
import type { VoiceExpert } from "../../../lib/fixtures/voice-experts";
import { useVoiceConversationSession, type VoiceConversationMessage } from "./useVoiceConversationSession";

interface VoiceConversationSessionContextValue {
  status: ConversationSessionStatus;
  messages: VoiceConversationMessage[];
  pendingTurn: boolean;
  amplitude: number;
  avatarContainerRef: RefObject<HTMLDivElement>;
}

const VoiceConversationSessionContext = createContext<VoiceConversationSessionContextValue | null>(null);

interface VoiceConversationSessionProviderProps {
  voiceSessionId: string;
  expert: VoiceExpert;
  micDisabled: boolean;
  language: Language;
  children: ReactNode;
}

// Lifts useVoiceConversationSession above VoiceStage (avatar) and
// VoiceTranscriptPanel (live transcript) — both need the same live
// conversation state, fed by one WebSocket. Mirrors
// sessions/[trainingSessionId]/ConversationSessionContext.tsx.
export function VoiceConversationSessionProvider({
  voiceSessionId,
  expert,
  micDisabled,
  language,
  children,
}: VoiceConversationSessionProviderProps) {
  const avatarContainerRef = useRef<HTMLDivElement>(null);
  const session = useVoiceConversationSession({
    voiceSessionId,
    expert,
    containerRef: avatarContainerRef,
    micDisabled,
    language,
  });

  return (
    <VoiceConversationSessionContext.Provider value={{ ...session, avatarContainerRef }}>
      {children}
    </VoiceConversationSessionContext.Provider>
  );
}

export function useVoiceConversationSessionContext(): VoiceConversationSessionContextValue {
  const ctx = useContext(VoiceConversationSessionContext);
  if (!ctx) {
    throw new Error("useVoiceConversationSessionContext must be used within a VoiceConversationSessionProvider");
  }
  return ctx;
}
