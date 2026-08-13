"use client";

import { useEffect, useRef } from "react";
import { useOnboarding } from "./OnboardingContext";
import { CheckIcon } from "./icons";
import styles from "./AvatarPreviewPanel.module.css";
import { GENDER_PHOTOS } from "./types";

/**
 * Renders the caller's real, live, talking avatar — the exact same
 * provider a real training session uses, resolved via
 * NEXT_PUBLIC_AVATAR_PROVIDER (default "vrm": the free, open-source,
 * lip-synced VRM renderer; opt-in "simli": paid photoreal video, face
 * resolved server-side from the authenticated Avatar record by
 * POST /v1/conversations/simli-session; opt-in "mock": idle-loop video).
 * See avatar-provider-factory.ts's doc comment for the full provider
 * selection story.
 *
 * Does NOT own the connection itself — OnboardingContext's liveAvatar does,
 * because this component's parent, /onboarding/[step]/layout.tsx, remounts
 * on every step change (its own path includes the [step] dynamic segment),
 * which would otherwise reconnect/rebuild the avatar on every Continue/Back
 * click. Instead, this component just re-parents the one persistent,
 * already-connected DOM node (Simli <video>, VRM <canvas>, or Mock <video>)
 * into its own wrapper on every mount — appendChild() on an already-attached
 * node relocates it without interrupting the live stream/render loop. See
 * OnboardingContext.tsx's LiveAvatarHandle doc comment.
 *
 * Falls back to a real static photo of the selected gender's Simli face
 * (GENDER_PHOTOS, captured from a live session — see types.ts's doc
 * comment) while still connecting or if the connection failed — the wizard
 * must never be blocked by this, and the fallback should still look like a
 * real avatar rather than a generic placeholder.
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
