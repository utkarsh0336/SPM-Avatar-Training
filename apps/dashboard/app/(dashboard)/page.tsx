"use client";

import styles from "./page.module.css";
import { useSessions } from "../sessions/SessionsContext";
import { useVoiceSessions } from "../voice-ai/VoiceSessionsContext";
import {
  BookmarkIcon,
  ChevronRightIcon,
  MicIcon,
  PinIcon,
  SparkleIcon,
  VideoIcon,
  WandIcon,
} from "../sessions/icons";

// Mock fixtures only carry a display string ("2h ago", "Yesterday", …), not a
// real timestamp, so merging the two independently-ordered session lists into
// one "recent activity" feed needs its own recency ranking rather than a
// plain sort by field.
function recencyRank(relativeTime: string): number {
  const value = relativeTime.toLowerCase();
  if (value === "just now") return 0;
  const hours = value.match(/^(\d+)h ago$/);
  if (hours) return 100 + Number(hours[1]);
  if (value === "yesterday") return 2000;
  const days = value.match(/^(\d+) days? ago$/);
  if (days) return 3000 + Number(days[1]) * 10;
  const weeks = value.match(/^(\d+) weeks? ago$/);
  if (weeks) return 8000 + Number(weeks[1]) * 100;
  return 99999;
}

interface ActivityItem {
  id: string;
  type: "video" | "voice";
  title: string;
  meta: string;
  relativeTime: string;
  pinned: boolean;
  href: string;
}

export default function DashboardHome() {
  const { sessions } = useSessions();
  const { sessions: voiceSessions } = useVoiceSessions();

  const videoCount = sessions.length;
  const voiceCount = voiceSessions.length;
  const pinnedCount =
    sessions.filter((session) => session.pinned).length +
    voiceSessions.filter((session) => session.pinned).length;

  const activity: ActivityItem[] = [
    ...sessions.map(
      (session): ActivityItem => ({
        id: session.id,
        type: "video",
        title: session.title,
        meta: `${session.listOwnerName} · ${session.listCategory}`,
        relativeTime: session.relativeTime,
        pinned: session.pinned,
        href: `/sessions/${session.id}`,
      }),
    ),
    ...voiceSessions.map(
      (session): ActivityItem => ({
        id: session.id,
        type: "voice",
        title: session.title,
        meta: `${session.expertName} · ${session.expertRole}`,
        relativeTime: session.relativeTime,
        pinned: session.pinned,
        href: `/voice-ai/${session.id}`,
      }),
    ),
  ]
    .sort((a, b) => recencyRank(a.relativeTime) - recencyRank(b.relativeTime))
    .slice(0, 6);

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>DASHBOARD</span>
        <h1 className={styles.title}>Welcome back, Rahul</h1>
        <p className={styles.subtitle}>Here&apos;s what&apos;s happening across your AI Avatar workspace today.</p>
      </div>

      <div className={styles.actionGrid}>
        <a href="/sessions" className={styles.actionCard}>
          <span className={`${styles.actionIcon} ${styles.actionIconVideo}`}>
            <VideoIcon size={20} />
          </span>
          <div className={styles.actionMeta}>
            <span className={styles.actionTitle}>New Video Chat</span>
            <span className={styles.actionSubtitle}>Start a live avatar training session</span>
          </div>
          <ChevronRightIcon size={16} className={styles.actionChevron} />
        </a>

        <a href="/voice-ai" className={styles.actionCard}>
          <span className={`${styles.actionIcon} ${styles.actionIconVoice}`}>
            <MicIcon size={20} />
          </span>
          <div className={styles.actionMeta}>
            <span className={styles.actionTitle}>Start Voice Session</span>
            <span className={styles.actionSubtitle}>Talk it through with an AI expert</span>
          </div>
          <ChevronRightIcon size={16} className={styles.actionChevron} />
        </a>

        <a href="/onboarding" className={styles.actionCard}>
          <span className={`${styles.actionIcon} ${styles.actionIconAvatar}`}>
            <WandIcon size={20} />
          </span>
          <div className={styles.actionMeta}>
            <span className={styles.actionTitle}>Customize Avatar</span>
            <span className={styles.actionSubtitle}>Update your AI trainer&apos;s look &amp; voice</span>
          </div>
          <ChevronRightIcon size={16} className={styles.actionChevron} />
        </a>
      </div>

      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <span className={styles.statIcon}>
            <SparkleIcon size={16} />
          </span>
          <span className={styles.statValue}>{videoCount + voiceCount}</span>
          <span className={styles.statLabel}>Total Conversations</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statIcon}>
            <VideoIcon size={16} />
          </span>
          <span className={styles.statValue}>{videoCount}</span>
          <span className={styles.statLabel}>Video Sessions</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statIcon}>
            <MicIcon size={16} />
          </span>
          <span className={styles.statValue}>{voiceCount}</span>
          <span className={styles.statLabel}>Voice Sessions</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statIcon}>
            <BookmarkIcon size={16} />
          </span>
          <span className={styles.statValue}>{pinnedCount}</span>
          <span className={styles.statLabel}>Pinned</span>
        </div>
      </div>

      <div className={styles.activityPanel}>
        <span className={styles.sectionLabel}>RECENT ACTIVITY</span>
        {activity.length === 0 ? (
          <span className={styles.emptyActivity}>No conversations yet — start one above.</span>
        ) : (
          <div className={styles.activityList}>
            {activity.map((item) => (
              <a key={`${item.type}-${item.id}`} href={item.href} className={styles.activityItem}>
                <span
                  className={`${styles.activityIcon} ${
                    item.type === "video" ? styles.activityIconVideo : styles.activityIconVoice
                  }`}
                >
                  {item.type === "video" ? <VideoIcon size={15} /> : <MicIcon size={15} />}
                </span>
                <div className={styles.activityMeta}>
                  <span className={styles.activityTitle}>
                    {item.title}
                    {item.pinned && <PinIcon size={11} className={styles.activityPin} />}
                  </span>
                  <span className={styles.activitySubtitle}>{item.meta}</span>
                </div>
                <span className={styles.activityTime}>{item.relativeTime}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
