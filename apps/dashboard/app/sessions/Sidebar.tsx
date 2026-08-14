"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { logout, type AuthOrg } from "../../lib/api-client";
import { useTranslation } from "../../lib/locale/LocaleProvider";
import { LocaleSwitcher } from "../../lib/locale/LocaleSwitcher";
import styles from "./Sidebar.module.css";
import {
  BellIcon,
  BookmarkIcon,
  BookOpenIcon,
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
export interface SidebarProps {
  // Undefined while the parent layout's getMe() is still resolving server-side
  // (never actually observable client-side, since layouts await it before
  // rendering) or null if it failed — either way, falls back to the
  // product's own name/default look rather than crashing. See
  // .claude/specs/tenant-branding.md.
  org?: AuthOrg | null;
}

export function Sidebar({ org }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const [personaDismissed, setPersonaDismissed] = useState(false);
  // /sessions, /voice-ai, and / (dashboard) are separate top-level route
  // trees sharing this one sidebar (see this file's own doc comment above) —
  // the active nav item reflects whichever hub the current route belongs to.
  const activeHub: "dashboard" | "new-chat" | "voice-ai" | "knowledge" | "avatars" = pathname?.startsWith("/voice-ai")
    ? "voice-ai"
    : pathname?.startsWith("/knowledge")
      ? "knowledge"
      : pathname?.startsWith("/avatars")
        ? "avatars"
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
      <div className={styles.workspace}>
        {org?.logoUrl && <img src={org.logoUrl} alt="" className={styles.workspaceLogo} />}
        <span>{org?.name ?? t("sessionsSidebar.workspaceFallback")}</span>
      </div>

      {!personaDismissed && (
        <div className={styles.personaCard}>
          <span className={styles.personaIcon}>
            <SparkleIcon size={16} />
          </span>
          <div className={styles.personaMeta}>
            <span className={styles.personaName}>{t("sessionsSidebar.personaName")}</span>
            <span className={styles.personaSubtitle}>{t("sessionsSidebar.personaSubtitle")}</span>
          </div>
          <button
            type="button"
            className={styles.personaClose}
            aria-label={t("sessionsSidebar.personaDismissAriaLabel")}
            onClick={() => setPersonaDismissed(true)}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      <nav className={styles.nav}>
        <div className={styles.navGroup}>
          <span className={styles.navLabel}>{t("sessionsSidebar.groupAiAvatarHub")}</span>
          <a href="/sessions" className={activeHub === "new-chat" ? styles.navItemActive : styles.navItem}>
            <VideoIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("sessionsSidebar.navNewChat")}</span>
            {activeHub === "new-chat" && <ChevronRightIcon size={14} className={styles.navChevron} />}
          </a>
          <a href="/voice-ai" className={activeHub === "voice-ai" ? styles.navItemActive : styles.navItem}>
            <MicIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("sessionsSidebar.navVoiceAi")}</span>
            {activeHub === "voice-ai" && <ChevronRightIcon size={14} className={styles.navChevron} />}
          </a>
          <a href="/sessions" className={styles.navItem}>
            <BookmarkIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("sessionsSidebar.navSavedConversations")}</span>
          </a>
          <a href="/knowledge" className={activeHub === "knowledge" ? styles.navItemActive : styles.navItem}>
            <BookOpenIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("sessionsSidebar.navKnowledgeBase")}</span>
            {activeHub === "knowledge" && <ChevronRightIcon size={14} className={styles.navChevron} />}
          </a>
          <a href="/avatars" className={activeHub === "avatars" ? styles.navItemActive : styles.navItem}>
            <UserIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("sessionsSidebar.navAvatars")}</span>
            {activeHub === "avatars" && <ChevronRightIcon size={14} className={styles.navChevron} />}
          </a>
        </div>

        <div className={styles.navGroup}>
          <span className={styles.navLabel}>{t("sessionsSidebar.groupMain")}</span>
          <a href="/" className={activeHub === "dashboard" ? styles.navItemActive : styles.navItem}>
            <GridIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("sessionsSidebar.navDashboard")}</span>
            {activeHub === "dashboard" && <ChevronRightIcon size={14} className={styles.navChevron} />}
          </a>
        </div>

        <div className={styles.navGroup}>
          <span className={styles.navLabel}>{t("sessionsSidebar.groupAccount")}</span>
          <a href="/" className={styles.navItem}>
            <BellIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("sessionsSidebar.navNotifications")}</span>
          </a>
          <a href="/" className={styles.navItem}>
            <HelpCircleIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("sessionsSidebar.navHelpCenter")}</span>
          </a>
          <a href="/" className={styles.navItem}>
            <UserIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("sessionsSidebar.navProfile")}</span>
          </a>
        </div>
      </nav>

      <LocaleSwitcher className={styles.localeToggle} />

      <div className={styles.userCard}>
        <span className={styles.userAvatar}>R</span>
        <div className={styles.userMeta}>
          <span className={styles.userName}>Rahul Sharma</span>
          <span className={styles.userRole}>{t("sessionsSidebar.userRole")}</span>
        </div>
        <button
          type="button"
          className={styles.userSettings}
          aria-label={t("sessionsSidebar.settingsAriaLabel")}
          onClick={() => window.location.assign("/settings")}
        >
          <GearIcon size={16} />
        </button>
        <button
          type="button"
          className={styles.userLogout}
          aria-label={t("sessionsSidebar.logoutAriaLabel")}
          onClick={() => void handleLogout()}
        >
          <LogOutIcon size={16} />
        </button>
      </div>
    </aside>
  );
}
