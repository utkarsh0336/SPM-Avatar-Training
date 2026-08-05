import styles from "./SessionListColumn.module.css";
import { ClockIcon, PinIcon } from "./icons";
import type { MockTrainingSession } from "../../lib/fixtures/mock-training-sessions";

interface SessionListItemProps {
  session: MockTrainingSession;
  active: boolean;
}

export function SessionListItem({ session, active }: SessionListItemProps) {
  return (
    <a
      href={`/sessions/${session.id}`}
      className={active ? styles.itemActive : styles.item}
      aria-current={active ? "page" : undefined}
    >
      <span className={styles.itemTitleRow}>
        <span className={styles.itemIcon}>
          {session.pinned ? <PinIcon size={12} /> : <ClockIcon size={12} />}
        </span>
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
