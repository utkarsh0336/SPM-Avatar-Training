"use client";

import { createContext, useContext, useRef, type ReactNode, type RefObject } from "react";
import type { ConversationSessionStatus } from "@avatrain/realtime-core";
import { useConversationSession, type ConversationMessage } from "./useConversationSession";

interface ConversationSessionContextValue {
  status: ConversationSessionStatus;
  messages: ConversationMessage[];
  pendingTurn: boolean;
  captionText: string;
  amplitude: number;
  avatarContainerRef: RefObject<HTMLDivElement>;
  /** Passed straight through from the provider's own prop — see .claude/specs/induction-checklist.md's ChecklistPanel. */
  avatarId?: string | null;
}

const ConversationSessionContext = createContext<ConversationSessionContextValue | null>(null);

interface ConversationSessionProviderProps {
  trainingSessionId: string;
  topic: string;
  muted: boolean;
  avatarId?: string | null;
  children: ReactNode;
}

/**
 * Lifts useConversationSession above VideoStage (avatar + captions) and
 * SidePanel/TranscriptPanel (live transcript) — both need the same live
 * conversation state, fed by one WebSocket. Calling the hook independently
 * in each component would open two WS connections for one session.
 */
export function ConversationSessionProvider({
  trainingSessionId,
  topic,
  muted,
  avatarId,
  children,
}: ConversationSessionProviderProps) {
  const avatarContainerRef = useRef<HTMLDivElement>(null);
  const session = useConversationSession({ trainingSessionId, topic, containerRef: avatarContainerRef, muted, avatarId });

  return (
    <ConversationSessionContext.Provider value={{ ...session, avatarContainerRef, avatarId }}>
      {children}
    </ConversationSessionContext.Provider>
  );
}

export function useConversationSessionContext(): ConversationSessionContextValue {
  const ctx = useContext(ConversationSessionContext);
  if (!ctx) {
    throw new Error("useConversationSessionContext must be used within a ConversationSessionProvider");
  }
  return ctx;
}
