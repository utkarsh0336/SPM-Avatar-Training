"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./VoiceHistoryColumn.module.css";
import { PlusIcon, SearchIcon } from "../sessions/icons";
import { useVoiceSessions } from "./VoiceSessionsContext";
import { VoiceHistoryItem } from "./VoiceHistoryItem";

export function VoiceHistoryColumn() {
  const { sessions } = useVoiceSessions();
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  const activeId = pathname?.startsWith("/voice-ai/") ? pathname.split("/")[2] : undefined;

  const matches = (title: string) => title.toLowerCase().includes(query.trim().toLowerCase());
  const pinned = sessions.filter((session) => session.pinned && matches(session.title));
  const recent = sessions.filter((session) => !session.pinned && matches(session.title));

  return (
    <div className={styles.column}>
      <a href="/voice-ai" className={styles.newChatButton}>
        <PlusIcon size={16} />
        New Voice Chat
      </a>

      <div className={styles.searchBox}>
        <SearchIcon size={15} />
        <input
          className={styles.searchInput}
          placeholder="Search history..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className={styles.groups}>
        <div className={styles.group}>
          <span className={styles.groupLabel}>PINNED</span>
          {pinned.length === 0 && <span className={styles.emptyGroup}>No pinned sessions</span>}
          {pinned.map((session) => (
            <VoiceHistoryItem key={session.id} session={session} active={session.id === activeId} />
          ))}
        </div>

        <div className={styles.group}>
          <span className={styles.groupLabel}>RECENT</span>
          {recent.length === 0 && <span className={styles.emptyGroup}>No recent sessions</span>}
          {recent.map((session) => (
            <VoiceHistoryItem key={session.id} session={session} active={session.id === activeId} />
          ))}
        </div>
      </div>
    </div>
  );
}
