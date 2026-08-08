"use client";

import { useParams } from "next/navigation";
import { useVoiceSessions } from "../VoiceSessionsContext";
import { VoiceHistoryColumn } from "../VoiceHistoryColumn";
import { getVoiceExpertById } from "../../../lib/fixtures/voice-experts";
import { VoiceChatSession } from "./VoiceChatSession";
import styles from "./page.module.css";

export default function VoiceSessionPage() {
  const params = useParams<{ voiceSessionId: string }>();
  const { getById } = useVoiceSessions();
  const session = getById(params.voiceSessionId);
  const expert = session ? getVoiceExpertById(session.expertId) : undefined;

  if (!session || !expert) {
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

  return <VoiceChatSession session={session} expert={expert} />;
}
