"use client";

import styles from "./LivePreviewPanel.module.css";
import { CameraIcon, CheckIcon } from "./icons";
import { useOnboarding } from "./OnboardingContext";
import {
  AVATAR_STYLE_LABELS,
  EXPERTISE_LABELS,
  GENDER_LABELS,
  GENDER_PHOTOS,
  HAIR_COLOR_SWATCHES,
  HAIR_STYLE_LABELS,
  OUTFIT_LABELS,
  SKIN_TONE_SWATCHES,
  VOICE_LABELS,
} from "./types";

export function LivePreviewPanel() {
  const { state } = useOnboarding();

  return (
    <div className={styles.panel}>
      <div className={styles.label}>
        <span className={styles.liveDot} />
        LIVE PREVIEW
      </div>

      <div className={styles.card}>
        <div className={styles.image}>
          <img src={GENDER_PHOTOS[state.gender]} alt="" className={styles.imagePhoto} />
        </div>

        {state.style && (
          <span className={styles.styleBadge}>
            <CameraIcon size={12} />
            {AVATAR_STYLE_LABELS[state.style]}
          </span>
        )}

        {state.style && (
          <span className={styles.checkBadge}>
            <CheckIcon size={12} />
          </span>
        )}

        <div className={styles.overlay}>
          <span className={styles.avatarName}>{state.name.trim() || "Your Avatar"}</span>
          <span className={styles.avatarExpertise}>{EXPERTISE_LABELS[state.expertise]}</span>
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Skin</span>
          <span className={styles.swatch} style={{ background: SKIN_TONE_SWATCHES[state.skinTone] }} />
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Hair</span>
          <span className={styles.swatch} style={{ background: HAIR_COLOR_SWATCHES[state.hairColor] }} />
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Style</span>
          <span className={styles.statValue}>{HAIR_STYLE_LABELS[state.hairStyle]}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Outfit</span>
          <span className={styles.statValue}>{OUTFIT_LABELS[state.outfit]}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Gender</span>
          <span className={styles.statValue}>{GENDER_LABELS[state.gender]}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Voice</span>
          <span className={styles.statValue}>{VOICE_LABELS[state.voice]}</span>
        </div>
      </div>
    </div>
  );
}
