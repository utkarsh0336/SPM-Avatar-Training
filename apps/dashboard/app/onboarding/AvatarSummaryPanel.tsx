"use client";

import styles from "./AvatarSummaryPanel.module.css";
import { useOnboarding } from "./OnboardingContext";
import {
  AGE_GROUP_LABELS,
  AVATAR_LANGUAGE_LABELS,
  AVATAR_REGION_LABELS,
  AVATAR_STYLE_LABELS,
  EXPERTISE_LABELS,
  GENDER_LABELS,
  HAIR_STYLE_LABELS,
  OUTFIT_TITLES,
} from "./types";

export function AvatarSummaryPanel() {
  const { state } = useOnboarding();
  const name = state.name.trim();

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span>✅</span>
        AVATAR SUMMARY
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Name</span>
        <span className={name ? styles.value : styles.valueUnset}>{name || "(unnamed)"}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Style</span>
        <span className={styles.value}>{state.style ? AVATAR_STYLE_LABELS[state.style] : "—"}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Gender</span>
        <span className={styles.value}>{GENDER_LABELS[state.gender]}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Hair</span>
        <span className={styles.value}>{HAIR_STYLE_LABELS[state.hairStyle]}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Outfit</span>
        <span className={styles.value}>{OUTFIT_TITLES[state.outfit]}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Expertise</span>
        <span className={styles.value}>{EXPERTISE_LABELS[state.expertise]}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Voice</span>
        <span className={styles.value}>{state.voice.toLowerCase()}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Age Group</span>
        <span className={styles.value}>{AGE_GROUP_LABELS[state.ageGroup]}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Region</span>
        <span className={styles.value}>{AVATAR_REGION_LABELS[state.region]}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Language</span>
        <span className={styles.value}>{AVATAR_LANGUAGE_LABELS[state.preferredLanguage]}</span>
      </div>
    </div>
  );
}
