"use client";

import { useCallback, useRef, useState } from "react";
import styles from "./VideoChatSession.module.css";
import { VideoStage } from "./VideoStage";
import { ControlBar } from "./ControlBar";
import { SidePanel } from "./SidePanel";
import { EndSessionDialog } from "./EndSessionDialog";
import { TrainingSessionProvider, useTrainingSessionUi } from "./TrainingSessionContext";
import { ConversationSessionProvider } from "./ConversationSessionContext";
import type { MockTrainingSession } from "../../../lib/fixtures/mock-training-sessions";

interface VideoChatSessionProps {
  session: MockTrainingSession;
}

export function VideoChatSession({ session }: VideoChatSessionProps) {
  return (
    <TrainingSessionProvider>
      <VideoChatSessionContent session={session} />
    </TrainingSessionProvider>
  );
}

function VideoChatSessionContent({ session }: VideoChatSessionProps) {
  const { state } = useTrainingSessionUi();
  const rootRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [ended, setEnded] = useState(false);

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

  function handleConfirmEnd() {
    setEndDialogOpen(false);
    setEnded(true);
  }

  if (ended) {
    return (
      <div className={styles.root}>
        <div className={styles.mainColumn}>
          <div className={styles.endedCard}>
            <span className={styles.endedTitle}>Session ended — view transcript</span>
            <span>{session.title}</span>
            <a className={styles.endedButton} href="/sessions">
              Back to sessions
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ConversationSessionProvider
      trainingSessionId={session.id}
      topic={session.topic}
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

        {endDialogOpen && <EndSessionDialog onCancel={handleCancelEnd} onConfirm={handleConfirmEnd} />}
      </div>
    </ConversationSessionProvider>
  );
}
