"use client";

import { useEffect, useState } from "react";
import type { Language } from "@avatrain/shared/tutor";
import type { TrainingSessionResult } from "@avatrain/shared/training-session";
import styles from "./VoiceChatSession.module.css";
import { VoiceHistoryColumn } from "../VoiceHistoryColumn";
import { VoiceStage } from "./VoiceStage";
import { VoiceControlBar } from "./VoiceControlBar";
import { VoiceTranscriptPanel } from "./VoiceTranscriptPanel";
import { EndVoiceSessionDialog } from "./EndVoiceSessionDialog";
import { VoiceSessionUiProvider, useVoiceSessionUi } from "./VoiceSessionUiContext";
import { VoiceConversationSessionProvider, useVoiceConversationSessionContext } from "./VoiceConversationSessionContext";
import { endTrainingSession, listTrainingSessionMessages } from "../../../lib/api-client";
import type { VoiceExpert } from "../../../lib/fixtures/voice-experts";
import type { VoiceConversationMessage } from "./useVoiceConversationSession";

interface VoiceChatSessionProps {
  session: TrainingSessionResult;
  expert: VoiceExpert;
  initialLanguage: Language;
}

// A session that was already ENDED before this page loaded (reopened from history) never opens a
// WS connection — its transcript comes from GET .../messages instead of the live conversation
// hook. Mirrors sessions/[trainingSessionId]/VideoChatSession.tsx.
export function VoiceChatSession({ session, expert, initialLanguage }: VoiceChatSessionProps) {
  if (session.status === "ENDED") {
    return <ReopenedEndedSession session={session} expert={expert} />;
  }
  return (
    <VoiceSessionUiProvider initialLanguage={initialLanguage}>
      <VoiceChatSessionContent session={session} expert={expert} />
    </VoiceSessionUiProvider>
  );
}

// VoiceTranscriptPanel is already fully in the accessibility tree (unlike video's TranscriptPanel
// — see that component's own doc comment), so it doubles as the read-only ended view directly;
// no separate "EndedTranscript" component needed here.
function EndedCard({
  expertName,
  messages,
}: {
  expertName: string;
  messages: VoiceConversationMessage[] | null;
}) {
  return (
    <>
      <VoiceHistoryColumn />
      <div className={styles.root}>
        <div className={styles.mainColumn}>
          {messages !== null && <VoiceTranscriptPanel messages={messages} pendingTurn={false} expertName={expertName} />}
        </div>
      </div>
    </>
  );
}

function ReopenedEndedSession({ session, expert }: { session: TrainingSessionResult; expert: VoiceExpert }) {
  const [messages, setMessages] = useState<VoiceConversationMessage[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTrainingSessionMessages(session.id)
      .then((result) => {
        if (cancelled) return;
        setMessages(
          result.messages.map((m) => ({ id: m.id, role: m.role === "USER" ? "USER" : "AVATAR", text: m.content })),
        );
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  return <EndedCard expertName={expert.name} messages={messages} />;
}

function VoiceChatSessionContent({ session, expert }: { session: TrainingSessionResult; expert: VoiceExpert }) {
  const { state } = useVoiceSessionUi();
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  // null = still live; non-null = the transcript captured at the moment End Session was
  // confirmed — see sessions/[trainingSessionId]/VideoChatSession.tsx's identical pattern and its
  // doc comment for why this drives teardown via unmount rather than an imperative disconnect.
  const [endedTranscript, setEndedTranscript] = useState<VoiceConversationMessage[] | null>(null);

  function handleCancelEnd() {
    setEndDialogOpen(false);
    document.getElementById("end-voice-session-trigger")?.focus();
  }

  if (endedTranscript !== null) {
    return <EndedCard expertName={expert.name} messages={endedTranscript} />;
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

        {endDialogOpen && (
          <EndSessionTrigger
            trainingSessionId={session.id}
            onCancel={handleCancelEnd}
            onEnded={(messages) => {
              setEndDialogOpen(false);
              setEndedTranscript(messages);
            }}
          />
        )}
      </div>
    </VoiceConversationSessionProvider>
  );
}

// Reads live conversation state from VoiceConversationSessionProvider — split out so that context
// read only happens for the (conditionally rendered) panel, matching
// sessions/[trainingSessionId]/SidePanel.tsx's equivalent split.
function VoiceTranscriptPanelSlot({ expertName }: { expertName: string }) {
  const { messages, pendingTurn } = useVoiceConversationSessionContext();
  return <VoiceTranscriptPanel messages={messages} pendingTurn={pendingTurn} expertName={expertName} />;
}

// Descendant of VoiceConversationSessionProvider so it can capture the live transcript at the
// exact moment the trainer confirms End Session — see the video tree's identical component.
function EndSessionTrigger({
  trainingSessionId,
  onCancel,
  onEnded,
}: {
  trainingSessionId: string;
  onCancel: () => void;
  onEnded: (messages: VoiceConversationMessage[]) => void;
}) {
  const { messages } = useVoiceConversationSessionContext();
  return (
    <EndVoiceSessionDialog
      onCancel={onCancel}
      onConfirm={() => {
        void endTrainingSession(trainingSessionId).catch(() => {
          // Best-effort — see the video tree's identical EndSessionTrigger for reasoning.
        });
        onEnded(messages);
      }}
    />
  );
}
