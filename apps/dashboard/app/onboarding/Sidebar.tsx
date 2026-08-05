import Link from "next/link";
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

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.workspace}>SPM MEDICARE AI</div>

      <div className={styles.personaCard}>
        <span className={styles.personaIcon}>
          <SparkleIcon size={16} />
        </span>
        <div className={styles.personaMeta}>
          <span className={styles.personaName}>AI Nancy</span>
          <span className={styles.personaSubtitle}>ENTERPRISE PLATFORM</span>
        </div>
        <button type="button" className={styles.personaClose} aria-label="Dismiss">
          <CloseIcon size={14} />
        </button>
      </div>

      <nav className={styles.nav}>
        <div className={styles.navGroup}>
          <span className={styles.navLabel}>AI AVATAR HUB</span>
          <Link href="/" className={styles.navItemActive}>
            <VideoIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>New Chat</span>
            <ChevronRightIcon size={14} className={styles.navChevron} />
          </Link>
          <Link href="/" className={styles.navItem}>
            <MicIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Voice AI</span>
          </Link>
          <Link href="/" className={styles.navItem}>
            <BookmarkIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Saved Conversations</span>
          </Link>
        </div>

        <div className={styles.navGroup}>
          <span className={styles.navLabel}>MAIN</span>
          <Link href="/" className={styles.navItem}>
            <GridIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Dashboard</span>
          </Link>
        </div>

        <div className={styles.navGroup}>
          <span className={styles.navLabel}>ACCOUNT</span>
          <Link href="/" className={styles.navItem}>
            <BellIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Notifications</span>
          </Link>
          <Link href="/" className={styles.navItem}>
            <HelpCircleIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Help Center</span>
          </Link>
          <Link href="/" className={styles.navItem}>
            <UserIcon size={16} className={styles.navIcon} />
            <span className={styles.navText}>Profile</span>
          </Link>
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
