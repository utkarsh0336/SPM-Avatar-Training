"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./SessionListColumn.module.css";
import { PlusIcon, SearchIcon } from "./icons";
import { useSessions } from "./SessionsContext";
import { SessionListItem } from "./SessionListItem";
import { NewSessionModal } from "./NewSessionModal";

export function SessionListColumn() {
  const { sessions } = useSessions();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const activeId = pathname?.startsWith("/sessions/") ? pathname.split("/")[2] : undefined;

  const matches = (title: string) => title.toLowerCase().includes(query.trim().toLowerCase());
  const pinned = sessions.filter((session) => session.pinned && matches(session.title));
  const recent = sessions.filter((session) => !session.pinned && matches(session.title));

  return (
    <div className={styles.column}>
      <button type="button" className={styles.newChatButton} onClick={() => setModalOpen(true)}>
        <PlusIcon size={16} />
        New Video Chat
      </button>

      <div className={styles.searchBox}>
        <SearchIcon size={15} />
        <input
          className={styles.searchInput}
          placeholder="Search..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className={styles.groups}>
        <div className={styles.group}>
          <span className={styles.groupLabel}>PINNED</span>
          {pinned.length === 0 && <span className={styles.emptyGroup}>No pinned sessions</span>}
          {pinned.map((session) => (
            <SessionListItem key={session.id} session={session} active={session.id === activeId} />
          ))}
        </div>

        <div className={styles.group}>
          <span className={styles.groupLabel}>RECENT</span>
          {recent.length === 0 && <span className={styles.emptyGroup}>No recent sessions</span>}
          {recent.map((session) => (
            <SessionListItem key={session.id} session={session} active={session.id === activeId} />
          ))}
        </div>
      </div>

      {modalOpen && <NewSessionModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
