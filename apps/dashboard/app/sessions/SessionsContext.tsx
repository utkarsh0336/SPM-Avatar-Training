"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { INITIAL_MOCK_SESSIONS, type MockTrainingSession } from "../../lib/fixtures/mock-training-sessions";

interface NewSessionInput {
  title: string;
  topic: string;
  /** Which of the org's avatars to use — omitted/null lets useConversationSession.ts pick the caller's default. */
  avatarId?: string | null;
}

interface SessionsContextValue {
  sessions: MockTrainingSession[];
  getById: (id: string) => MockTrainingSession | undefined;
  addSession: (input: NewSessionInput) => MockTrainingSession;
  togglePinned: (id: string) => void;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

// Milestone 1 only: sessions live in memory for the tab's lifetime, seeded from
// the mock fixture. Replaced by GET/POST /v1/training-sessions in Milestone 2.
export function SessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<MockTrainingSession[]>(INITIAL_MOCK_SESSIONS);

  const getById = useCallback(
    (id: string) => sessions.find((session) => session.id === id),
    [sessions],
  );

  const addSession = useCallback((input: NewSessionInput) => {
    const created: MockTrainingSession = {
      id: `session-${Date.now()}`,
      title: input.title,
      listOwnerName: "You",
      listCategory: input.topic,
      relativeTime: "Just now",
      pinned: false,
      topic: input.topic,
      avatarId: input.avatarId ?? null,
      captionText: "",
      transcript: [],
      pendingTurn: false,
    };
    setSessions((prev) => [created, ...prev]);
    return created;
  }, []);

  const togglePinned = useCallback((id: string) => {
    setSessions((prev) =>
      prev.map((session) => (session.id === id ? { ...session, pinned: !session.pinned } : session)),
    );
  }, []);

  const value = useMemo<SessionsContextValue>(
    () => ({ sessions, getById, addSession, togglePinned }),
    [sessions, getById, addSession, togglePinned],
  );

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) {
    throw new Error("useSessions must be used within a SessionsProvider");
  }
  return ctx;
}
