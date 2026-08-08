"use client";

import { useState } from "react";
import styles from "./VoiceChatSession.module.css";
import { VoiceHistoryColumn } from "../VoiceHistoryColumn";
import { VoiceStage } from "./VoiceStage";
import { VoiceControlBar } from "./VoiceControlBar";
import { VoiceTranscriptPanel } from "./VoiceTranscriptPanel";
import { EndVoiceSessionDialog } from "./EndVoiceSessionDialog";
import { VoiceSessionUiProvider, useVoiceSessionUi } from "./VoiceSessionUiContext";
import { VoiceConversationSessionProvider, useVoiceConversationSessionContext } from "./VoiceConversationSessionContext";
import type { MockVoiceSession } from "../../../lib/fixtures/mock-voice-sessions";
import type { VoiceExpert } from "../../../lib/fixtures/voice-experts";

interface VoiceChatSessionProps {
  session: MockVoiceSession;
  expert: VoiceExpert;
}

export function VoiceChatSession({ session, expert }: VoiceChatSessionProps) {
  return (
    <VoiceSessionUiProvider initialLanguage={session.language}>
      <VoiceChatSessionContent session={session} expert={expert} />
    </VoiceSessionUiProvider>
  );
}

function VoiceChatSessionContent({ session, expert }: VoiceChatSessionProps) {
  const { state } = useVoiceSessionUi();
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [ended, setEnded] = useState(false);

  function handleCancelEnd() {
    setEndDialogOpen(false);
    document.getElementById("end-voice-session-trigger")?.focus();
  }

  function handleConfirmEnd() {
    setEndDialogOpen(false);
    setEnded(true);
  }

  if (ended) {
    return (
      <>
        <VoiceHistoryColumn />
        <div className={styles.root}>
          <div className={styles.mainColumn}>
            <div className={styles.endedCard}>
              <span className={styles.endedTitle}>Session ended — view transcript</span>
              <span>{session.title}</span>
              <a className={styles.endedButton} href="/voice-ai">
                Start a new voice session
              </a>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <VoiceConversationSessionProvider
      voiceSessionId={session.id}
      expert={expert}
      micDisabled={state.muted || state.paused}
      language={state.language}
    >
      <VoiceHistoryColumn />
      <div className={styles.root}>
        <div className={styles.mainColumn}>
          <VoiceStage expert={expert} />
          <VoiceControlBar onEndSession={() => setEndDialogOpen(true)} />
        </div>

        {state.panelVisible && <VoiceTranscriptPanelSlot expertName={expert.name} />}

        {endDialogOpen && <EndVoiceSessionDialog onCancel={handleCancelEnd} onConfirm={handleConfirmEnd} />}
      </div>
    </VoiceConversationSessionProvider>
  );
}

// Reads live conversation state from VoiceConversationSessionProvider —
// split out so that context read only happens for the (conditionally
// rendered) panel, matching sessions/[trainingSessionId]/SidePanel.tsx's
// equivalent split.
function VoiceTranscriptPanelSlot({ expertName }: { expertName: string }) {
  const { messages, pendingTurn } = useVoiceConversationSessionContext();
  return <VoiceTranscriptPanel messages={messages} pendingTurn={pendingTurn} expertName={expertName} />;
}
