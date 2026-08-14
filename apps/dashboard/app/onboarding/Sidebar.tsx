"use client";

import Link from "next/link";
import type { AuthOrg } from "../../lib/api-client";
import { useTranslation } from "../../lib/locale/LocaleProvider";
import { LocaleSwitcher } from "../../lib/locale/LocaleSwitcher";
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

export interface SidebarProps {
  org?: AuthOrg | null;
}

export function Sidebar({ org }: SidebarProps) {
  const { t } = useTranslation();
  return (
    <aside className={styles.sidebar}>
      <div className={styles.workspace}>
        {org?.logoUrl && <img src={org.logoUrl} alt="" className={styles.workspaceLogo} />}
        <span>{org?.name ?? t("onboardingSidebar.workspaceFallback")}</span>
      </div>

      <div className={styles.personaCard}>
        <span className={styles.personaIcon}>
          <SparkleIcon size={16} />
        </span>
        <div className={styles.personaMeta}>
          <span className={styles.personaName}>{t("onboardingSidebar.personaName")}</span>
          <span className={styles.personaSubtitle}>{t("onboardingSidebar.personaSubtitle")}</span>
        </div>
        <button type="button" className={styles.personaClose} aria-label={t("onboardingSidebar.personaDismissAriaLabel")}>
          <CloseIcon size={14} />
        </button>
      </div>

      <nav className={styles.nav}>
        <div className={styles.navGroup}>
          <span className={styles.navLabel}>{t("onboardingSidebar.groupAiAvatarHub")}</span>
          <Link href="/" className={styles.navItemActive}>
            <VideoIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("onboardingSidebar.navNewChat")}</span>
            <ChevronRightIcon size={14} className={styles.navChevron} />
          </Link>
          <Link href="/voice-ai" className={styles.navItem}>
            <MicIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("onboardingSidebar.navVoiceAi")}</span>
          </Link>
          <Link href="/" className={styles.navItem}>
            <BookmarkIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("onboardingSidebar.navSavedConversations")}</span>
          </Link>
        </div>

        <div className={styles.navGroup}>
          <span className={styles.navLabel}>{t("onboardingSidebar.groupMain")}</span>
          <Link href="/" className={styles.navItem}>
            <GridIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("onboardingSidebar.navDashboard")}</span>
          </Link>
        </div>

        <div className={styles.navGroup}>
          <span className={styles.navLabel}>{t("onboardingSidebar.groupAccount")}</span>
          <Link href="/" className={styles.navItem}>
            <BellIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("onboardingSidebar.navNotifications")}</span>
          </Link>
          <Link href="/" className={styles.navItem}>
            <HelpCircleIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("onboardingSidebar.navHelpCenter")}</span>
          </Link>
          <Link href="/" className={styles.navItem}>
            <UserIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>{t("onboardingSidebar.navProfile")}</span>
          </Link>
        </div>
      </nav>

      <LocaleSwitcher className={styles.localeToggle} />

      <div className={styles.userCard}>
        <span className={styles.userAvatar}>R</span>
        <div className={styles.userMeta}>
          <span className={styles.userName}>Rahul Sharma</span>
          <span className={styles.userRole}>{t("onboardingSidebar.userRole")}</span>
        </div>
        <a href="/settings" className={styles.userSettings} aria-label={t("onboardingSidebar.settingsAriaLabel")}>
          <GearIcon size={16} />
        </a>
      </div>
    </aside>
  );
}
