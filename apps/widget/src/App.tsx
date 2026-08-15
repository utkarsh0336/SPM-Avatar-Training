import { useEffect, useRef, useState } from "react";
import { useEmbedSession } from "./useEmbedSession.js";
import styles from "./App.module.css";

const STATUS_LABEL: Record<string, string> = {
  idle: "Loading…",
  connecting: "Connecting…",
  listening: "Tap to speak",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Connection error",
  ended: "Session ended",
};

function readEmbedKey(): string {
  return new URLSearchParams(window.location.search).get("key") ?? "";
}

/**
 * The actual embeddable "AI avatar trainer on any website" surface —
 * apps/widget was a placeholder until this pass. Loaded inside the
 * sandboxed <iframe> packages/embed/src/index.ts's init() creates, with the
 * publishable key on this page's own ?key= query param (see that file's
 * doc comment on why — avoids the config/ticket requests needing a
 * Content-Type header at all, keeping both a "simple" CORS request with no
 * preflight).
 */
export function App() {
  const [embedKey] = useState(readEmbedKey);
  const [muted, setMuted] = useState(false);
  // Local to this component, not the session hook — see .claude/specs/user-satisfaction.md's
  // Overview: apps/widget had no "end session" affordance at all before this, so "Leave" opening
  // this prompt (rather than disconnecting immediately) is what gives the rating somewhere to go.
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { status, captionText, amplitude, errorMessage, endSession } = useEmbedSession({
    embedKey,
    containerRef,
    muted,
  });

  function submitRating(): void {
    endSession(selectedRating ?? undefined, comment.trim() || undefined);
    setShowRatingPrompt(false);
  }

  function skipRating(): void {
    endSession();
    setShowRatingPrompt(false);
  }

  // Tells the parent frame we're up. "*" as the targetOrigin is correct
  // here, not a shortcut: the widget legitimately can't know its embedding
  // parent's origin ahead of time (any site may embed it) — the real
  // security boundary is server-side (routes/embed.ts's allowedOrigins
  // check on config/ticket), and packages/embed's own listener still
  // verifies event.source === its iframe before trusting anything it
  // receives, regardless of what targetOrigin this page used to send it.
  useEffect(() => {
    window.parent.postMessage({ type: "avatrain:ready" }, "*");
  }, []);

  // Reports actual rendered height so the parent can size the iframe to
  // fit instead of a hardcoded default — see
  // packages/embed/src/index.ts's avatrain:resize handling.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) window.parent.postMessage({ type: "avatrain:resize", height: Math.ceil(height) }, "*");
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  if (!embedKey) {
    return (
      <main className={styles.root} ref={rootRef}>
        <p className={styles.error}>Missing embed key — this widget was not loaded correctly.</p>
      </main>
    );
  }

  const isSpeaking = status === "speaking";
  const isLive = status === "connecting" || status === "listening" || status === "thinking" || status === "speaking";

  return (
    <main className={styles.root} ref={rootRef}>
      <div className={`${styles.avatarRing} ${isSpeaking ? styles.avatarRingSpeaking : ""}`}>
        <div
          ref={containerRef}
          className={styles.avatarSink}
          style={{ transform: `scale(${1 + Math.min(amplitude, 1) * 0.05})` }}
        />
      </div>

      {captionText && <p className={styles.caption}>{captionText}</p>}
      {errorMessage && (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      )}

      {showRatingPrompt ? (
        <div className={styles.ratingPrompt} role="dialog" aria-label="Rate this session">
          <p className={styles.ratingPromptTitle}>How was this session?</p>
          <div className={styles.ratingStars} role="radiogroup" aria-label="Rating, 1 to 5 stars">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selectedRating === value}
                aria-label={`${value} star${value === 1 ? "" : "s"}`}
                className={styles.ratingStar}
                onClick={() => setSelectedRating(value)}
              >
                {selectedRating !== null && value <= selectedRating ? "★" : "☆"}
              </button>
            ))}
          </div>
          <textarea
            className={styles.ratingComment}
            placeholder="Anything else you'd like to share? (optional)"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={500}
            rows={2}
          />
          <div className={styles.ratingActions}>
            <button type="button" className={styles.ratingSkipButton} onClick={skipRating}>
              Skip
            </button>
            <button
              type="button"
              className={styles.ratingSubmitButton}
              onClick={submitRating}
              disabled={selectedRating === null}
            >
              Submit
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.controls}>
          <span className={styles.statusPill}>{STATUS_LABEL[status] ?? status}</span>
          <button
            type="button"
            className={muted ? styles.micButtonMuted : styles.micButton}
            onClick={() => setMuted((m) => !m)}
            aria-pressed={muted}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          {isLive && (
            <button type="button" className={styles.leaveButton} onClick={() => setShowRatingPrompt(true)}>
              Leave
            </button>
          )}
        </div>
      )}
    </main>
  );
}
