import styles from "./VoiceTranscriptPanel.module.css";
import { VoiceTranscriptBubble } from "./VoiceTranscriptBubble";
import type { VoiceConversationMessage } from "./useVoiceConversationSession";

interface VoiceTranscriptPanelProps {
  messages: VoiceConversationMessage[];
  pendingTurn: boolean;
  expertName: string;
}

// Voice AI's counterpart to sessions/[trainingSessionId]/TranscriptPanel.tsx.
// Unlike that panel, this one is NOT aria-hidden — there is no separate
// CaptionBar in the Voice AI design acting as the screen-reader announcement
// source (no video/caption overlay here), so this is the sole transcript
// surface and must stay accessible.
export function VoiceTranscriptPanel({ messages, pendingTurn, expertName }: VoiceTranscriptPanelProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.sectionLabel}>
          <span className={styles.liveDot} />
          LIVE TRANSCRIPT
        </span>
        <span className={styles.livePill}>LIVE</span>
      </div>

      <div className={styles.transcript} aria-live="polite">
        {messages.length === 0 && !pendingTurn && (
          <span className={styles.empty}>Say something to start the conversation.</span>
        )}
        {messages.map((message) => (
          <VoiceTranscriptBubble key={message.id} message={message} expertName={expertName} />
        ))}
        {pendingTurn && (
          <div className={styles.bubbleRow}>
            <span className={styles.bubble} style={{ background: "rgba(139, 92, 246, 0.16)" }}>
              <span className={styles.typingDots}>
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
              </span>
            </span>
          </div>
        )}
      </div>

      <span className={styles.footnote}>Transcript is auto-generated and may contain errors.</span>
    </div>
  );
}
