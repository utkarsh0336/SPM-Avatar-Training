"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { logout } from "../../lib/api-client";
import styles from "./Sidebar.module.css";
import {
  BellIcon,
  BookmarkIcon,
  ChevronRightIcon,
  CloseIcon,
  GearIcon,
  GridIcon,
  HelpCircleIcon,
  LogOutIcon,
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
  const pathname = usePathname();
  const [personaDismissed, setPersonaDismissed] = useState(false);
  // /sessions, /voice-ai, and / (dashboard) are separate top-level route
  // trees sharing this one sidebar (see this file's own doc comment above) —
  // the active nav item reflects whichever hub the current route belongs to.
  const activeHub: "dashboard" | "new-chat" | "voice-ai" = pathname?.startsWith("/voice-ai")
    ? "voice-ai"
    : pathname?.startsWith("/sessions")
      ? "new-chat"
      : "dashboard";

  // Same logout call + redirect as (dashboard)/LogoutButton.tsx — this
  // sidebar persists across /sessions and /sessions/[trainingSessionId], so
  // this is the only logout affordance visible while a live avatar call is
  // in progress (the (dashboard) route group's header never wraps this
  // section — see apps/dashboard/app/sessions/layout.tsx).
  async function handleLogout(): Promise<void> {
    await logout();
    window.location.assign("/login");
  }

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
          <a href="/sessions" className={activeHub === "new-chat" ? styles.navItemActive : styles.navItem}>
            <VideoIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>New CHAT</span>
            {activeHub === "new-chat" && <ChevronRightIcon size={14} className={styles.navChevron} />}
          </a>
          <a href="/voice-ai" className={activeHub === "voice-ai" ? styles.navItemActive : styles.navItem}>
            <MicIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Voice AI</span>
            {activeHub === "voice-ai" && <ChevronRightIcon size={14} className={styles.navChevron} />}
          </a>
          <a href="/sessions" className={styles.navItem}>
            <BookmarkIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Saved Conversations</span>
          </a>
        </div>

        <div className={styles.navGroup}>
          <span className={styles.navLabel}>MAIN</span>
          <a href="/" className={activeHub === "dashboard" ? styles.navItemActive : styles.navItem}>
            <GridIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Dashboard</span>
            {activeHub === "dashboard" && <ChevronRightIcon size={14} className={styles.navChevron} />}
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
        <button type="button" className={styles.userLogout} aria-label="Log out" onClick={() => void handleLogout()}>
          <LogOutIcon size={16} />
        </button>
      </div>
    </aside>
  );
}
