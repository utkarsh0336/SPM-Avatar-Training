/**
 * Server-side turn-boundary detection over raw PCM frames — the counterpart
 * to packages/realtime-core/src/voice-activity-detector.ts's browser VAD,
 * which is unusable here (it's built on AudioContext/AnalyserNode/
 * requestAnimationFrame, none of which exist in apps/agent's Node process).
 * Same algorithm and default constants (RMS threshold 0.02, 700ms silence,
 * 300ms minimum speech), ported from a requestAnimationFrame poll to a
 * discrete "push one frame, react immediately" model since audio here
 * arrives as discrete @livekit/rtc-node AudioFrames, not a continuously
 * pollable analyser.
 */
export interface TurnBoundaryOptions {
  /** RMS level (0-1) above which a frame counts as speech. */
  silenceThreshold?: number;
  /** How long RMS must stay below the threshold before speech is considered ended. */
  silenceDurationMs?: number;
  /** Minimum speech duration before silence is allowed to end it. */
  minSpeechDurationMs?: number;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  /** Injectable for tests; defaults to Date.now. */
  now?: () => number;
}

export interface TurnBoundaryDetector {
  /** Feed one frame's RMS (0-1) and the detector reacts immediately — no polling loop. */
  pushFrameRms(rms: number): void;
  reset(): void;
}

const DEFAULT_SILENCE_THRESHOLD = 0.02;
const DEFAULT_SILENCE_DURATION_MS = 700;
const DEFAULT_MIN_SPEECH_DURATION_MS = 300;

export function createTurnBoundaryDetector(options: TurnBoundaryOptions): TurnBoundaryDetector {
  const now = options.now ?? Date.now;
  const silenceThreshold = options.silenceThreshold ?? DEFAULT_SILENCE_THRESHOLD;
  const silenceDurationMs = options.silenceDurationMs ?? DEFAULT_SILENCE_DURATION_MS;
  const minSpeechDurationMs = options.minSpeechDurationMs ?? DEFAULT_MIN_SPEECH_DURATION_MS;

  let speaking = false;
  let speechStartedAt = 0;
  let silenceStartedAt: number | null = null;

  return {
    pushFrameRms(rms: number): void {
      const t = now();
      if (rms > silenceThreshold) {
        silenceStartedAt = null;
        if (!speaking) {
          speaking = true;
          speechStartedAt = t;
          options.onSpeechStart();
        }
        return;
      }
      if (!speaking) return;
      if (silenceStartedAt === null) silenceStartedAt = t;
      const speechDuration = t - speechStartedAt;
      const silenceDuration = t - silenceStartedAt;
      if (speechDuration >= minSpeechDurationMs && silenceDuration >= silenceDurationMs) {
        speaking = false;
        silenceStartedAt = null;
        options.onSpeechEnd();
      }
    },
    reset(): void {
      speaking = false;
      speechStartedAt = 0;
      silenceStartedAt = null;
    },
  };
}
