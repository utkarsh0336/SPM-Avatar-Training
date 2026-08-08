"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./VoiceStage.module.css";
import { MicIcon, MicOffIcon } from "../../sessions/icons";
import { useVoiceConversationSessionContext } from "./VoiceConversationSessionContext";
import { useVoiceSessionUi } from "./VoiceSessionUiContext";
import type { VoiceExpert } from "../../../lib/fixtures/voice-experts";

interface VoiceStageProps {
  expert: VoiceExpert;
}

const STATUS_LABEL: Record<string, string> = {
  connecting: "Connecting…",
  listening: "Tap to speak",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Connection error",
  ended: "Session ended",
};

/**
 * Exponential-moving-average follower for the raw per-frame amplitude value
 * (itself already sampled at ~60fps by MockAvatarProvider's own rAF loop —
 * see packages/avatar-core/src/mock-avatar-provider.ts) — binding a waveform/
 * scale transform directly to that raw value looks jittery frame to frame.
 * Runs its own persistent rAF loop (started once, reading the latest target
 * via a ref) rather than restarting on every target change, which is what
 * amplitude does dozens of times a second.
 */
function useSmoothedAmplitude(target: number, smoothing = 0.15): number {
  const [smoothed, setSmoothed] = useState(0);
  const targetRef = useRef(target);
  const smoothedRef = useRef(0);
  targetRef.current = target;

  useEffect(() => {
    let rafId: number;
    function tick() {
      smoothedRef.current += (targetRef.current - smoothedRef.current) * smoothing;
      setSmoothed(smoothedRef.current);
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [smoothing]);

  return smoothed;
}

// Voice AI's counterpart to sessions/[trainingSessionId]/VideoStage.tsx: a
// circular avatar (no camera preview) plus a push-affordance mic button that
// mirrors the Mute control — the underlying VAD-driven transport listens
// continuously, so this toggles the same mic gate rather than a separate
// push-to-talk mode the transport doesn't support.
export function VoiceStage({ expert }: VoiceStageProps) {
  const { status, amplitude, avatarContainerRef } = useVoiceConversationSessionContext();
  const { state, update } = useVoiceSessionUi();
  const micGated = state.muted || state.paused;
  const isSpeaking = status === "speaking";
  const smoothedAmplitude = useSmoothedAmplitude(isSpeaking ? amplitude : 0);

  return (
    <div className={styles.stage}>
      <div className={styles.liveBadge}>
        <span className={styles.liveDot} />
        LIVE SESSION
        <span className={styles.liveTopic}>· {expert.topic}</span>
      </div>

      <div className={`${styles.avatarRing} ${isSpeaking ? styles.avatarRingSpeaking : ""}`}>
        <div
          className={styles.avatarCircle}
          style={{ transform: `scale(${1 + Math.min(smoothedAmplitude, 1) * 0.06})` }}
        >
          {/*
            The provider (Mock or Simli) mounts its own video/audio into this
            container — see useVoiceConversationSession.ts's avatarProvider.start().
            Neither can be made to render the SPECIFIC expert the user picked on
            Page 1 (Mock's idle clips are generic stock footage per replica type;
            Simli renders the caller's own onboarding-configured face, unrelated
            to the Voice AI expert catalog entirely) — so it's rendered first,
            and the expert's own photo is stacked after it in the DOM to always
            paint on top (same stacking-context, later element wins with no
            z-index needed), guaranteeing the visible avatar always matches the
            one actually selected. The container itself stays full-size and
            un-hidden (not display:none / zero-size) purely so its <audio>
            element — the actual TTS playback — is never at risk of an autoplay
            suspend some browsers apply to hidden/detached media elements.
          */}
          <div ref={avatarContainerRef} className={styles.avatarSink} />
          <img src={expert.photoSrc} alt="" className={styles.avatarPhoto} />
        </div>
      </div>

      <div className={styles.nameBlock}>
        <span className={styles.name}>{expert.name}</span>
        <span className={styles.subtitle}>
          {expert.role} · {state.language}
        </span>
      </div>

      <button type="button" className={styles.statusPill} onClick={() => update({ muted: !state.muted })}>
        <span className={styles.statusDot} />
        {STATUS_LABEL[status] ?? "Connecting…"}
      </button>

      <div className={styles.waveform} aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => {
          const mid = 4;
          const distance = Math.abs(index - mid);
          const baseHeight = 6 + (mid - distance) * 3;
          const boost = isSpeaking ? Math.min(smoothedAmplitude * 40, 16) : 0;
          return (
            <span
              key={index}
              className={`${styles.waveformBar} ${isSpeaking ? styles.waveformBarActive : ""}`}
              style={{ height: `${baseHeight + boost}px` }}
            />
          );
        })}
      </div>

      <button
        type="button"
        className={micGated ? styles.micButtonMuted : styles.micButton}
        aria-pressed={micGated}
        aria-label={micGated ? "Unmute microphone" : "Mute microphone"}
        onClick={() => update({ muted: !state.muted })}
      >
        {micGated ? <MicOffIcon size={26} /> : <MicIcon size={26} />}
      </button>
    </div>
  );
}
