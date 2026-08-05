"use client";

import { useState } from "react";
import styles from "./Sidebar.module.css";
import {
  BellIcon,
  BookmarkIcon,
  ChevronRightIcon,
  CloseIcon,
  GearIcon,
  GridIcon,
  HelpCircleIcon,
  MicIcon,
  SparkleIcon,
  UserIcon,
  VideoIcon,
} from "./icons";

// Generalized from apps/dashboard/app/onboarding/Sidebar.tsx for the AI Avatar Hub
// (session list + video chat). Kept as its own copy per this codebase's existing
// per-feature convention rather than a premature shared-package extraction — see
// .claude/specs/video-chat-session.md UI Changes / Files to Create.
export function Sidebar() {
  const [personaDismissed, setPersonaDismissed] = useState(false);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.workspace}>SPM MEDICARE AI</div>

      {!personaDismissed && (
        <div className={styles.personaCard}>
          <span className={styles.personaIcon}>
            <SparkleIcon size={16} />
          </span>
          <div className={styles.personaMeta}>
            <span className={styles.personaName}>AI Nancy</span>
            <span className={styles.personaSubtitle}>ENTERPRISE PLATFORM</span>
          </div>
          <button
            type="button"
            className={styles.personaClose}
            aria-label="Dismiss"
            onClick={() => setPersonaDismissed(true)}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      <nav className={styles.nav}>
        <div className={styles.navGroup}>
          <span className={styles.navLabel}>AI AVATAR HUB</span>
          <a href="/sessions" className={styles.navItemActive}>
            <VideoIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>New CHAT</span>
            <ChevronRightIcon size={14} className={styles.navChevron} />
          </a>
          <a href="/sessions" className={styles.navItem}>
            <MicIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Voice AI</span>
          </a>
          <a href="/sessions" className={styles.navItem}>
            <BookmarkIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Saved Conversations</span>
          </a>
        </div>

        <div className={styles.navGroup}>
          <span className={styles.navLabel}>MAIN</span>
          <a href="/" className={styles.navItem}>
            <GridIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Dashboard</span>
          </a>
        </div>

        <div className={styles.navGroup}>
          <span className={styles.navLabel}>ACCOUNT</span>
          <a href="/" className={styles.navItem}>
            <BellIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Notifications</span>
          </a>
          <a href="/" className={styles.navItem}>
            <HelpCircleIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Help Center</span>
          </a>
          <a href="/" className={styles.navItem}>
            <UserIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Profile</span>
          </a>
        </div>
      </nav>

      <div className={styles.userCard}>
        <span className={styles.userAvatar}>R</span>
        <div className={styles.userMeta}>
          <span className={styles.userName}>Rahul Sharma</span>
          <span className={styles.userRole}>Sales Team</span>
        </div>
        <button type="button" className={styles.userSettings} aria-label="Settings">
          <GearIcon size={16} />
        </button>
      </div>
    </aside>
  );
}
