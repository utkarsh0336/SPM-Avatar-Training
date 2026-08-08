import styles from "./VoiceTranscriptPanel.module.css";
import { SparkleIcon } from "../../sessions/icons";
import type { VoiceConversationMessage } from "./useVoiceConversationSession";

interface VoiceTranscriptBubbleProps {
  message: VoiceConversationMessage;
  expertName: string;
}

export function VoiceTranscriptBubble({ message, expertName }: VoiceTranscriptBubbleProps) {
  const isUser = message.role === "USER";

  return (
    <div className={`${styles.bubbleRow} ${isUser ? styles.bubbleRowUser : ""}`}>
      <span className={styles.speakerLabel}>
        {isUser ? (
          <>
            <span className={styles.speakerName}>You</span>
            <span className={styles.userBadge}>Y</span>
          </>
        ) : (
          <>
            <span className={styles.avatarBadge}>
              <SparkleIcon size={11} />
            </span>
            <span className={styles.speakerName}>{expertName}</span>
          </>
        )}
      </span>
      <span className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAvatar}`}>{message.text}</span>
    </div>
  );
}
