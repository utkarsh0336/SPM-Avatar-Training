import styles from "./SidePanel.module.css";
import { CameraPreview } from "./CameraPreview";
import { TranscriptPanel } from "./TranscriptPanel";
import { useConversationSessionContext } from "./ConversationSessionContext";

interface SidePanelProps {
  cameraOff: boolean;
  muted: boolean;
}

// Toggled as one unit by the ControlBar's "Hide Panel" control (camera preview +
// transcript together) — the reference screenshot's control literally reads
// "Hide Panel", not "Hide Transcript". See
// .claude/specs/video-chat-session.md Session Controls table.
export function SidePanel({ cameraOff, muted }: SidePanelProps) {
  const { messages, pendingTurn } = useConversationSessionContext();
  return (
    <div className={styles.panel}>
      <CameraPreview cameraOff={cameraOff} muted={muted} />
      <TranscriptPanel messages={messages} pendingTurn={pendingTurn} />
    </div>
  );
}
