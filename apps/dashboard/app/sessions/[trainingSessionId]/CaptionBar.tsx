import styles from "./CaptionBar.module.css";

interface CaptionBarProps {
  text: string;
  topic: string;
}

// The single authoritative screen-reader announcement source for the avatar's
// current utterance — the transcript panel is aria-hidden to avoid a duplicate
// announcement of the same turn. See .claude/specs/video-chat-session.md
// Accessibility, "Explicit dedup decision".
export function CaptionBar({ text, topic }: CaptionBarProps) {
  if (!text) return null;

  const topicIndex = text.indexOf(topic);
  const before = topicIndex >= 0 ? text.slice(0, topicIndex) : text;
  const after = topicIndex >= 0 ? text.slice(topicIndex + topic.length) : "";

  return (
    <div className={styles.captionWrap}>
      <p className={styles.caption} aria-live="polite">
        {before}
        {topicIndex >= 0 && <span className={styles.captionTopic}>{topic}</span>}
        {after}
      </p>
    </div>
  );
}
