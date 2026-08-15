import styles from "./SessionListColumn.module.css";
import { ClockIcon, PinIcon } from "./icons";
import { useSessions, type SessionListItemView } from "./SessionsContext";

interface SessionListItemProps {
  session: SessionListItemView;
  active: boolean;
}

export function SessionListItem({ session, active }: SessionListItemProps) {
  const { togglePinned } = useSessions();

  return (
    <a
      href={`/sessions/${session.id}`}
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
        <span className={`${styles.itemTitle} ${active ? styles.itemTitleBold : ""}`}>
          {session.title}
        </span>
      </span>
      <span className={styles.itemSubtitle}>
        {session.listOwnerName} · {session.listCategory} · {session.relativeTime}
      </span>
    </a>
  );
}
