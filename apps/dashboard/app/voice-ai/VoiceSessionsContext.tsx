"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TrainingSessionResult } from "@avatrain/shared/training-session";
import {
  createTrainingSession as apiCreateTrainingSession,
  listTrainingSessions,
  setTrainingSessionPinned,
} from "../../lib/api-client";
import { formatRelativeTime } from "../../lib/format-relative-time";
import { getVoiceExpertById } from "../../lib/fixtures/voice-experts";

/** Display shape for VoiceHistoryItem.tsx/(dashboard)/page.tsx — a projection of
 * TrainingSessionResult, mirroring SessionsContext.tsx's SessionListItemView convention. */
export interface VoiceSessionListItemView {
  id: string;
  title: string;
  expertName: string;
  expertRole: string;
  relativeTime: string;
  pinned: boolean;
}

interface NewVoiceSessionInput {
  expertId: string;
}

interface VoiceSessionsContextValue {
  sessions: VoiceSessionListItemView[];
  addSession: (input: NewVoiceSessionInput) => Promise<TrainingSessionResult>;
  togglePinned: (id: string) => void;
}

const VoiceSessionsContext = createContext<VoiceSessionsContextValue | null>(null);

function toListItem(session: TrainingSessionResult, pinned: boolean): VoiceSessionListItemView {
  return {
    id: session.id,
    title: session.title,
    expertName: session.personaName,
    expertRole: session.personaRole,
    relativeTime: formatRelativeTime(session.updatedAt),
    pinned,
  };
}

// Real GET/POST/PATCH /v1/training-sessions?kind=VOICE_ONLY data — see
// .claude/specs/video-chat-session.md (Milestone 2). Replaces the Milestone-1
// mock-voice-sessions.ts fixture. Mirrors SessionsContext.tsx's structure exactly — both
// dashboard trees hit the identical backend, discriminated only by `kind`.
export function VoiceSessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<VoiceSessionListItemView[]>([]);

  const refresh = useCallback(async () => {
    const { pinned, recent } = await listTrainingSessions("VOICE_ONLY");
    setSessions([...pinned.map((s) => toListItem(s, true)), ...recent.map((s) => toListItem(s, false))]);
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      // No hard failure at mount — the list just stays empty.
    });
  }, [refresh]);

  const addSession = useCallback(async (input: NewVoiceSessionInput): Promise<TrainingSessionResult> => {
    const expert = getVoiceExpertById(input.expertId);
    const created = await apiCreateTrainingSession({
      kind: "VOICE_ONLY",
      title: expert ? `${expert.role} Session` : "Voice Session",
      voiceExpertId: input.expertId,
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
      void setTrainingSessionPinned(id, nextPinned).catch(() => {
        setSessions((cur) => cur.map((session) => (session.id === id ? { ...session, pinned: !nextPinned } : session)));
      });
      return prev.map((session) => (session.id === id ? { ...session, pinned: nextPinned } : session));
    });
  }, []);

  const value = useMemo<VoiceSessionsContextValue>(
    () => ({ sessions, addSession, togglePinned }),
    [sessions, addSession, togglePinned],
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
