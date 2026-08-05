import styles from "./SidePanel.module.css";
import { CameraPreview } from "./CameraPreview";
import { TranscriptPanel } from "./TranscriptPanel";
import type { MockTrainingSession } from "../../../lib/fixtures/mock-training-sessions";

interface SidePanelProps {
  session: MockTrainingSession;
  cameraOff: boolean;
  muted: boolean;
}

// Toggled as one unit by the ControlBar's "Hide Panel" control (camera preview +
// transcript together) — the reference screenshot's control literally reads
// "Hide Panel", not "Hide Transcript". See
// .claude/specs/video-chat-session.md Session Controls table.
export function SidePanel({ session, cameraOff, muted }: SidePanelProps) {
  return (
    <div className={styles.panel}>
      <CameraPreview cameraOff={cameraOff} muted={muted} />
      <TranscriptPanel messages={session.transcript} pendingTurn={session.pendingTurn} />
    </div>
  );
}
