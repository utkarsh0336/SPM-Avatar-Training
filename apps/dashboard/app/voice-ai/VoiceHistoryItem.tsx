import styles from "./VoiceHistoryColumn.module.css";
import { ClockIcon, PinIcon } from "../sessions/icons";
import type { MockVoiceSession } from "../../lib/fixtures/mock-voice-sessions";

interface VoiceHistoryItemProps {
  session: MockVoiceSession;
  active: boolean;
}

export function VoiceHistoryItem({ session, active }: VoiceHistoryItemProps) {
  return (
    <a
      href={`/voice-ai/${session.id}`}
      className={active ? styles.itemActive : styles.item}
      aria-current={active ? "page" : undefined}
    >
      <span className={styles.itemTitleRow}>
        <span className={styles.itemIcon}>
          {session.pinned ? <PinIcon size={12} /> : <ClockIcon size={12} />}
        </span>
        <span className={`${styles.itemTitle} ${active ? styles.itemTitleBold : ""}`}>{session.title}</span>
      </span>
      <span className={styles.itemSubtitle}>
        {session.expertName} · {session.expertRole} · {session.relativeTime}
      </span>
    </a>
  );
}
