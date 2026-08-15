import styles from "./TranscriptPanel.module.css";
import type { ConversationMessage } from "./useConversationSession";

export function TranscriptBubble({ message }: { message: ConversationMessage }) {
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
