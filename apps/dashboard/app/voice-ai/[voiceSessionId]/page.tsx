"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import type { Language } from "@avatrain/shared/tutor";
import type { TrainingSessionResult } from "@avatrain/shared/training-session";
import { VoiceHistoryColumn } from "../VoiceHistoryColumn";
import { getVoiceExpertById } from "../../../lib/fixtures/voice-experts";
import { getTrainingSession } from "../../../lib/api-client";
import { VoiceChatSession } from "./VoiceChatSession";
import styles from "./page.module.css";

const KNOWN_LANGUAGES: Language[] = ["English", "Hindi", "Spanish"];

// The language picked in voice-ai/page.tsx's picker travels here as a query param, not a
// persisted field — it's a session-start-time input for the live connection, not identity data
// (see VoiceSessionsContext.tsx). Reopening from history (no query param) defaults to English,
// same posture .claude/specs/video-chat-session.md's draft took for sticky UI toggles generally:
// nothing in this codebase persists a spoken-language preference across reloads.
function resolveLanguage(raw: string | null): Language {
  return (KNOWN_LANGUAGES as string[]).includes(raw ?? "") ? (raw as Language) : "English";
}

export default function VoiceSessionPage() {
  const params = useParams<{ voiceSessionId: string }>();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<TrainingSessionResult | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setNotFound(false);
    getTrainingSession(params.voiceSessionId)
      .then((result) => {
        if (!cancelled) setSession(result);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [params.voiceSessionId]);

  const expert = session?.voiceExpertId ? getVoiceExpertById(session.voiceExpertId) : undefined;

  if (notFound || (session && !expert)) {
    return (
      <>
        <VoiceHistoryColumn />
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>Session not found</span>
          <span>It may have been removed, or the link is out of date.</span>
        </div>
      </>
    );
  }

  if (!session || !expert) return null;

  return <VoiceChatSession session={session} expert={expert} initialLanguage={resolveLanguage(searchParams.get("language"))} />;
}
