"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrainingSessionResult } from "@avatrain/shared/training-session";
import styles from "./VideoChatSession.module.css";
import { VideoStage } from "./VideoStage";
import { ControlBar } from "./ControlBar";
import { SidePanel } from "./SidePanel";
import { EndSessionDialog } from "./EndSessionDialog";
import { EndedTranscript } from "./EndedTranscript";
import { TrainingSessionProvider, useTrainingSessionUi } from "./TrainingSessionContext";
import { ConversationSessionProvider, useConversationSessionContext } from "./ConversationSessionContext";
import { endTrainingSession, listTrainingSessionMessages } from "../../../lib/api-client";
import type { ConversationMessage } from "./useConversationSession";

interface VideoChatSessionProps {
  session: TrainingSessionResult;
}

// A session that was already ENDED before this page loaded (reopened from the list, or a fresh
// navigation) never opens a WS connection — its transcript comes from GET .../messages instead of
// the live conversation hook. See .claude/specs/video-chat-session.md, "an ENDED session can
// never be rejoined live."
export function VideoChatSession({ session }: VideoChatSessionProps) {
  if (session.status === "ENDED") {
    return <ReopenedEndedSession session={session} />;
  }
  return (
    <TrainingSessionProvider>
      <VideoChatSessionContent session={session} />
    </TrainingSessionProvider>
  );
}

function EndedTranscriptCard({ title, messages }: { title: string; messages: ConversationMessage[] | null }) {
  return (
    <div className={styles.root}>
      <div className={styles.mainColumn}>
        <div className={styles.endedTranscriptCard}>
          <div className={styles.endedTranscriptHeader}>
            <span className={styles.endedTranscriptTitle}>{title} — ended</span>
            <a className={styles.endedTranscriptBack} href="/sessions">
              Back to sessions
            </a>
          </div>
          {messages !== null && <EndedTranscript messages={messages} />}
        </div>
      </div>
    </div>
  );
}

function ReopenedEndedSession({ session }: VideoChatSessionProps) {
  const [messages, setMessages] = useState<ConversationMessage[] | null>(null);

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

  return <EndedTranscriptCard title={session.title} messages={messages} />;
}

function VideoChatSessionContent({ session }: VideoChatSessionProps) {
  const { state } = useTrainingSessionUi();
  const rootRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  // null = still live; non-null = the transcript captured at the moment End Session was
  // confirmed. Setting this unmounts ConversationSessionProvider below (this component no longer
  // renders it once non-null), which is what actually tears down the WS connection — the hook's
  // own cleanup effect sends session.end, matching every other provider-unmount-driven teardown
  // in this codebase; there's no separate imperative "disconnect" method to call.
  const [endedTranscript, setEndedTranscript] = useState<ConversationMessage[] | null>(null);

  const toggleFullscreen = useCallback(async () => {
    if (!rootRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await rootRef.current.requestFullscreen();
        setFullscreen(true);
      } else {
        await document.exitFullscreen();
        setFullscreen(false);
      }
    } catch {
      // Fullscreen API can reject (e.g. sandboxed iframe) — degrade silently,
      // the control bar remains fully usable either way.
    }
  }, []);

  function handleCancelEnd() {
    setEndDialogOpen(false);
    document.getElementById("end-session-trigger")?.focus();
  }

  if (endedTranscript !== null) {
    return <EndedTranscriptCard title={session.title} messages={endedTranscript} />;
  }

  return (
    <ConversationSessionProvider
      trainingSessionId={session.id}
      topic={session.topic ?? ""}
      muted={state.muted}
      avatarId={session.avatarId}
    >
      <div className={styles.root} ref={rootRef}>
        <div className={styles.mainColumn}>
          <VideoStage session={session} />
          <ControlBar
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
            onEndSession={() => setEndDialogOpen(true)}
          />
        </div>

        {state.panelVisible && <SidePanel cameraOff={state.cameraOff} muted={state.muted} />}

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
    </ConversationSessionProvider>
  );
}

// Descendant of ConversationSessionProvider so it can capture the live transcript at the exact
// moment the trainer confirms End Session — the messages held here are always complete and
// immediate, unlike a GET .../messages refetch, which could race
// persistTrainingSessionMessage's fire-and-forget insert of the very last turn(s).
function EndSessionTrigger({
  trainingSessionId,
  onCancel,
  onEnded,
}: {
  trainingSessionId: string;
  onCancel: () => void;
  onEnded: (messages: ConversationMessage[]) => void;
}) {
  const { messages } = useConversationSessionContext();
  return (
    <EndSessionDialog
      onCancel={onCancel}
      onConfirm={() => {
        void endTrainingSession(trainingSessionId).catch(() => {
          // Best-effort — the trainer already sees the ended view; a failed end call just means
          // the row's status catches up next time it's touched (e.g. a future connect attempt).
        });
        onEnded(messages);
      }}
    />
  );
}
