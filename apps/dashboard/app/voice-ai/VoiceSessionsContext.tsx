"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Language } from "@avatrain/shared/tutor";
import { INITIAL_MOCK_VOICE_SESSIONS, type MockVoiceSession } from "../../lib/fixtures/mock-voice-sessions";
import { getVoiceExpertById } from "../../lib/fixtures/voice-experts";

interface NewVoiceSessionInput {
  expertId: string;
  language: Language;
}

interface VoiceSessionsContextValue {
  sessions: MockVoiceSession[];
  getById: (id: string) => MockVoiceSession | undefined;
  addSession: (input: NewVoiceSessionInput) => MockVoiceSession;
}

const VoiceSessionsContext = createContext<VoiceSessionsContextValue | null>(null);

// Milestone 1 only, mirrors SessionsContext.tsx: voice sessions live in
// memory for the tab's lifetime, seeded from the mock fixture. Global (in
// the root layout) for the same reason SessionsProvider is — starting a
// session from the picker (Page 1) and navigating straight into it needs the
// same provider instance the live-session page reads from via getById().
export function VoiceSessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<MockVoiceSession[]>(INITIAL_MOCK_VOICE_SESSIONS);

  const getById = useCallback(
    (id: string) => sessions.find((session) => session.id === id),
    [sessions],
  );

  const addSession = useCallback((input: NewVoiceSessionInput) => {
    const expert = getVoiceExpertById(input.expertId);
    const created: MockVoiceSession = {
      id: `voice-${Date.now()}`,
      title: expert ? `${expert.role} Session` : "Voice Session",
      expertId: input.expertId,
      expertName: expert?.name ?? "AI Expert",
      expertRole: expert?.role ?? "Multi-topic",
      language: input.language,
      relativeTime: "Just now",
      pinned: false,
    };
    setSessions((prev) => [created, ...prev]);
    return created;
  }, []);

  const value = useMemo<VoiceSessionsContextValue>(
    () => ({ sessions, getById, addSession }),
    [sessions, getById, addSession],
  );

  return <VoiceSessionsContext.Provider value={value}>{children}</VoiceSessionsContext.Provider>;
}

export function useVoiceSessions(): VoiceSessionsContextValue {
  const ctx = useContext(VoiceSessionsContext);
  if (!ctx) {
    throw new Error("useVoiceSessions must be used within a VoiceSessionsProvider");
  }
  return ctx;
}
