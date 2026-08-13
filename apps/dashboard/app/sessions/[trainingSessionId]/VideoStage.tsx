"use client";

import styles from "./VideoStage.module.css";
import { SpeakerIcon, UserIcon } from "../icons";
import { CaptionBar } from "./CaptionBar";
import { useConversationSessionContext } from "./ConversationSessionContext";
import type { MockTrainingSession } from "../../../lib/fixtures/mock-training-sessions";

interface VideoStageProps {
  session: MockTrainingSession;
}

// The active avatar provider (packages/avatar-core, resolved by
// NEXT_PUBLIC_AVATAR_PROVIDER — default "vrm", a real amplitude-driven
// lip-synced 3D model; see avatar-provider-factory.ts) mounts into
// avatarContainerRef. 80% of the product experience is the conversation,
// not the mouth, but the mouth does move.
export function VideoStage({ session }: VideoStageProps) {
  const { status, captionText, amplitude, avatarContainerRef } = useConversationSessionContext();
  const isLive = status === "listening" || status === "thinking" || status === "speaking";

  return (
    <div className={styles.stage}>
      <div className={styles.avatarPlaceholder} ref={avatarContainerRef}>
        {!isLive && <UserIcon size={72} className={styles.avatarPlaceholderIcon} />}
      </div>

      <div className={styles.liveBadge}>
        <span className={styles.liveDot} />
        LIVE
      </div>

      <div className={styles.headerBadge}>
        <SpeakerIcon size={14} />
        <span className={styles.headerAvatarName}>My Avatar</span>
        <span className={styles.headerTopic}>· {session.topic}</span>
        {status === "speaking" && (
          <span className={styles.waveform} aria-hidden="true">
            <span className={styles.waveformBar} />
            <span className={styles.waveformBar} />
            <span className={styles.waveformBar} />
            <span className={styles.waveformBar} />
          </span>
        )}
      </div>

      <div className={styles.topicPill}>{session.topic}</div>

      {status === "speaking" && (
        <div className={styles.amplitudeTrack} aria-hidden="true">
          <div className={styles.amplitudeFill} style={{ transform: `scaleX(${Math.min(amplitude * 2, 1)})` }} />
        </div>
      )}

      <CaptionBar text={captionText} topic={session.topic} />
    </div>
  );
}
