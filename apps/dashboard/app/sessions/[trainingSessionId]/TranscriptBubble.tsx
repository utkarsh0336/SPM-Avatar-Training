import styles from "./TranscriptPanel.module.css";
import type { MockTranscriptMessage } from "../../../lib/fixtures/mock-training-sessions";

export function TranscriptBubble({ message }: { message: MockTranscriptMessage }) {
  const isUser = message.role === "USER";

  return (
    <div className={`${styles.bubbleRow} ${isUser ? styles.bubbleRowUser : ""}`}>
      {!isUser && <span className={styles.avatarBadge}>M</span>}
      <span className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAvatar}`}>
        {message.text}
      </span>
    </div>
  );
}
