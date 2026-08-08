"use client";

import { useEffect, useRef } from "react";
import { useOnboarding } from "./OnboardingContext";
import { CheckIcon } from "./icons";
import styles from "./AvatarPreviewPanel.module.css";
import { GENDER_PHOTOS } from "./types";

/**
 * Renders the caller's real, live, lip-synced Simli avatar — the exact same
 * face a real training session uses (POST /v1/conversations/simli-session
 * resolves it server-side from the authenticated Avatar record) — when
 * NEXT_PUBLIC_AVATAR_PROVIDER=simli is configured.
 *
 * Does NOT own the WebRTC connection itself — OnboardingContext's
 * liveAvatar does, because this component's parent,
 * /onboarding/[step]/layout.tsx, remounts on every step change (its own
 * path includes the [step] dynamic segment), which would otherwise
 * reconnect Simli on every Continue/Back click. Instead, this component
 * just re-parents the one persistent, already-connected video/audio DOM
 * node into its own wrapper on every mount — appendChild() on an
 * already-attached node relocates it without interrupting the live stream.
 * See OnboardingContext.tsx's LiveAvatarHandle doc comment.
 *
 * Falls back to a real static photo of the selected gender's Simli face
 * (GENDER_PHOTOS, captured from a live session — see types.ts's doc
 * comment) when Simli isn't configured, is still connecting, or failed to
 * connect — the wizard must never be blocked by this, and the fallback
 * should still look like the real avatar rather than a generic placeholder.
 */
export function AvatarPreviewPanel() {
  const { state, liveAvatar } = useOnboarding();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!liveAvatar || !wrapperRef.current) return;
    wrapperRef.current.appendChild(liveAvatar.containerElement);
  }, [liveAvatar]);

  const showLiveVideo = liveAvatar?.status === "connected";

  return (
    <div className={styles.panel}>
      <div className={styles.label}>
        <span className={styles.liveDot} />
        {liveAvatar ? "LIVE AVATAR" : "AVATAR PREVIEW"}
      </div>

      <div className={styles.card}>
        {liveAvatar && (
          <div
            ref={wrapperRef}
            className={styles.videoContainer}
            style={{ display: showLiveVideo ? "block" : "none" }}
          />
        )}

        {!showLiveVideo && <img src={GENDER_PHOTOS[state.gender]} alt="" className={styles.fallbackPhoto} />}

        {liveAvatar?.status === "connecting" && (
          <div className={styles.connectingBadge}>Connecting…</div>
        )}

        {state.style && (
          <span className={styles.checkBadge}>
            <CheckIcon size={12} />
          </span>
        )}

        <div className={styles.overlay}>
          <span className={styles.avatarName}>{state.name.trim() || "Your Avatar"}</span>
        </div>
      </div>
    </div>
  );
}
