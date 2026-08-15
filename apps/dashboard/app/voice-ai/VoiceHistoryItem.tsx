import styles from "./VoiceHistoryColumn.module.css";
import { ClockIcon, PinIcon } from "../sessions/icons";
import { useVoiceSessions, type VoiceSessionListItemView } from "./VoiceSessionsContext";

interface VoiceHistoryItemProps {
  session: VoiceSessionListItemView;
  active: boolean;
}

export function VoiceHistoryItem({ session, active }: VoiceHistoryItemProps) {
  const { togglePinned } = useVoiceSessions();

  return (
    <a
      href={`/voice-ai/${session.id}`}
      className={active ? styles.itemActive : styles.item}
      aria-current={active ? "page" : undefined}
    >
      <span className={styles.itemTitleRow}>
        <button
          type="button"
          className={styles.itemIcon}
          aria-label={session.pinned ? "Unpin session" : "Pin session"}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePinned(session.id);
          }}
        >
          {session.pinned ? <PinIcon size={12} /> : <ClockIcon size={12} />}
        </button>
        <span className={`${styles.itemTitle} ${active ? styles.itemTitleBold : ""}`}>{session.title}</span>
      </span>
      <span className={styles.itemSubtitle}>
        {session.expertName} · {session.expertRole} · {session.relativeTime}
      </span>
    </a>
  );
}
