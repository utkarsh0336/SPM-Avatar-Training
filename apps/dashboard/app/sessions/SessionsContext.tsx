"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TrainingSessionResult } from "@avatrain/shared/training-session";
import {
  createTrainingSession as apiCreateTrainingSession,
  listTrainingSessions,
  setTrainingSessionPinned,
} from "../../lib/api-client";
import { formatRelativeTime } from "../../lib/format-relative-time";

/** Display shape for SessionListItem.tsx/(dashboard)/page.tsx — a projection of TrainingSessionResult,
 * not the full API record (the individual session page fetches that itself, see
 * [trainingSessionId]/page.tsx). */
export interface SessionListItemView {
  id: string;
  title: string;
  listOwnerName: string;
  listCategory: string;
  relativeTime: string;
  pinned: boolean;
}

interface NewSessionInput {
  title: string;
  topic: string;
  /** Which of the org's avatars to use — omitted/null lets the server fall back to the caller's own ACTIVE-first avatar (training-session-service.ts's resolvePersona). */
  avatarId?: string | null;
}

interface SessionsContextValue {
  sessions: SessionListItemView[];
  addSession: (input: NewSessionInput) => Promise<TrainingSessionResult>;
  togglePinned: (id: string) => void;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

function toListItem(session: TrainingSessionResult, pinned: boolean): SessionListItemView {
  return {
    id: session.id,
    title: session.title,
    listOwnerName: session.personaName,
    listCategory: session.personaRole,
    relativeTime: formatRelativeTime(session.updatedAt),
    pinned,
  };
}

// Real GET/POST/PATCH /v1/training-sessions data — see .claude/specs/video-chat-session.md
// (Milestone 2). Replaces the Milestone-1 mock-training-sessions.ts fixture.
export function SessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionListItemView[]>([]);

  const refresh = useCallback(async () => {
    const { pinned, recent } = await listTrainingSessions("VIDEO_CHAT");
    setSessions([...pinned.map((s) => toListItem(s, true)), ...recent.map((s) => toListItem(s, false))]);
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      // No hard failure at mount — the list just stays empty; the "+ New Video Chat" flow and
      // individual session pages surface their own errors independently.
    });
  }, [refresh]);

  const addSession = useCallback(async (input: NewSessionInput): Promise<TrainingSessionResult> => {
    const created = await apiCreateTrainingSession({
      kind: "VIDEO_CHAT",
      title: input.title,
      topic: input.topic,
      avatarId: input.avatarId ?? undefined,
      clientRequestId: crypto.randomUUID(),
    });
    setSessions((prev) => [toListItem(created, false), ...prev]);
    return created;
  }, []);

  const togglePinned = useCallback((id: string) => {
    setSessions((prev) => {
      const current = prev.find((session) => session.id === id);
      if (!current) return prev;
      const nextPinned = !current.pinned;
      // Optimistic — reverted below if the server call fails.
      void setTrainingSessionPinned(id, nextPinned).catch(() => {
        setSessions((cur) => cur.map((session) => (session.id === id ? { ...session, pinned: !nextPinned } : session)));
      });
      return prev.map((session) => (session.id === id ? { ...session, pinned: nextPinned } : session));
    });
  }, []);

  const value = useMemo<SessionsContextValue>(
    () => ({ sessions, addSession, togglePinned }),
    [sessions, addSession, togglePinned],
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
