import sidePanelStyles from "./SidePanel.module.css";
import styles from "./TranscriptPanel.module.css";
import { TranscriptBubble } from "./TranscriptBubble";
import type { ConversationMessage } from "./useConversationSession";

interface TranscriptPanelProps {
  messages: ConversationMessage[];
  pendingTurn: boolean;
}

// aria-hidden: CaptionBar is the single authoritative screen-reader
// announcement source for the current utterance (see CaptionBar.tsx) — this
// panel would otherwise double-announce the same turn. See
// .claude/specs/video-chat-session.md Accessibility, "Explicit dedup decision".
export function TranscriptPanel({ messages, pendingTurn }: TranscriptPanelProps) {
  return (
    <div aria-hidden="true">
      <span className={sidePanelStyles.sectionLabel}>
        <span className={sidePanelStyles.liveDot} />
        LIVE TRANSCRIPT
      </span>
      <div className={styles.transcript}>
        {messages.map((message) => (
          <TranscriptBubble key={message.id} message={message} />
        ))}
        {pendingTurn && (
          <div className={styles.bubbleRow}>
            <span className={styles.avatarBadge}>M</span>
            <span className={`${styles.bubble} ${styles.bubbleAvatar}`}>
              <span className={styles.typingDots}>
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
