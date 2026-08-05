import styles from "./VideoStage.module.css";
import { SpeakerIcon, UserIcon } from "../icons";
import { CaptionBar } from "./CaptionBar";
import type { MockTrainingSession } from "../../../lib/fixtures/mock-training-sessions";

interface VideoStageProps {
  session: MockTrainingSession;
}

// Real implementation (Milestone 4) mounts packages/avatar-core's AvatarRenderer
// here — see .claude/specs/video-chat-session.md Realtime Changes / Implementation
// Rules ("built only against AvatarRenderer's interface"). This placeholder plays
// the same role as onboarding/LivePreviewPanel's gradient placeholder.
export function VideoStage({ session }: VideoStageProps) {
  return (
    <div className={styles.stage}>
      <div className={styles.avatarPlaceholder}>
        <UserIcon size={72} className={styles.avatarPlaceholderIcon} />
      </div>

      <div className={styles.liveBadge}>
        <span className={styles.liveDot} />
        LIVE
      </div>

      <div className={styles.headerBadge}>
        <SpeakerIcon size={14} />
        <span className={styles.headerAvatarName}>My Avatar</span>
        <span className={styles.headerTopic}>· {session.topic}</span>
        {session.pendingTurn && (
          <span className={styles.waveform} aria-hidden="true">
            <span className={styles.waveformBar} />
            <span className={styles.waveformBar} />
            <span className={styles.waveformBar} />
            <span className={styles.waveformBar} />
          </span>
        )}
      </div>

      <div className={styles.topicPill}>{session.topic}</div>

      <CaptionBar text={session.captionText} topic={session.topic} />
    </div>
  );
}
