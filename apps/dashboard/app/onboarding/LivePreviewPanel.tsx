"use client";

import { useEffect, useRef } from "react";
import { createVrmAvatarPreviewRenderer, type AvatarPreviewConfig, type AvatarPreviewRenderer } from "@avatrain/avatar-core";
import styles from "./LivePreviewPanel.module.css";
import { CameraIcon, CheckIcon } from "./icons";
import { useOnboarding } from "./OnboardingContext";
import {
  AVATAR_STYLE_LABELS,
  EXPERTISE_LABELS,
  GENDER_LABELS,
  HAIR_COLOR_SWATCHES,
  HAIR_STYLE_LABELS,
  OUTFIT_LABELS,
  SKIN_TONE_SWATCHES,
  VOICE_LABELS,
} from "./types";

export function LivePreviewPanel() {
  const { state } = useOnboarding();
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<AvatarPreviewRenderer | null>(null);
  const skipNextUpdateRef = useRef(true); // the mount effect below already renders the first config

  const previewConfig: AvatarPreviewConfig = {
    style: state.style,
    gender: state.gender,
    skinTone: state.skinTone,
    hairStyle: state.hairStyle,
    hairColor: state.hairColor,
    outfit: state.outfit,
    previewProvider: state.previewProvider,
    avatarModelUrl: state.avatarModelUrl,
    avatarSnapshotUrl: state.avatarSnapshotUrl,
  };

  // Mounts once. This is the first screen where a trainer sees the exact
  // skin tone/hair color/outfit picks actually rendered on a model, rather
  // than a static per-gender photo plus text swatch chips next to it — the
  // same VRM pipeline (packages/avatar-core) a live training session uses.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const renderer = createVrmAvatarPreviewRenderer();
    rendererRef.current = renderer;
    void renderer.render(previewConfig, container);
    return () => {
      renderer.destroy();
      rendererRef.current = null;
      skipNextUpdateRef.current = true;
    };
    // Deliberately []: mounts once, using whatever previewConfig snapshot
    // exists on the first render — later changes flow through the update
    // effect below, not a remount.
  }, []);

  useEffect(() => {
    if (skipNextUpdateRef.current) {
      skipNextUpdateRef.current = false;
      return; // this run coincides with the mount effect above — already rendered
    }
    rendererRef.current?.update(previewConfig);
    // Deliberately the individual state.* fields, not previewConfig itself
    // (a fresh object every render) — that would fire on every keystroke
    // elsewhere in the wizard, not just when a previewable field changes.
  }, [
    state.style,
    state.gender,
    state.skinTone,
    state.hairStyle,
    state.hairColor,
    state.outfit,
    state.previewProvider,
    state.avatarModelUrl,
    state.avatarSnapshotUrl,
  ]);

  return (
    <div className={styles.panel}>
      <div className={styles.label}>
        <span className={styles.liveDot} />
        LIVE PREVIEW
      </div>

      <div className={styles.card}>
        <div className={styles.image} ref={containerRef} />

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
