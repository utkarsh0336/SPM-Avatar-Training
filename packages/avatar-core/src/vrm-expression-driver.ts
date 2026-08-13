import type { VRM } from "@pixiv/three-vrm";

export interface VrmExpressionDriverOptions {
  /** Multiplies raw amplitude (0..~1 RMS from audio-amplitude.ts) before clamping to the expression's 0..1 weight range. */
  gain?: number;
}

export interface VrmExpressionDriver {
  /** Drives the "aa" mouth-open viseme proportional to the current speech amplitude. */
  setAmplitude(amplitude: number): void;
  /** Zeroes the mouth weight — call on interrupt/stop so a barge-in doesn't leave the mouth stuck open. */
  reset(): void;
}

const MOUTH_EXPRESSION = "aa";
const DEFAULT_GAIN = 2.2;

/**
 * Drives a VRM's viseme blend shape from a live amplitude signal —
 * audio-reactive mouth movement, not phoneme-accurate lip sync (that needs
 * viseme timing from the TTS layer, which the current TTS providers
 * — packages/shared/src/providers/tts-*.ts — don't emit). This is the same
 * simplification MockAvatarProvider's amplitude-only UI cue already made
 * deliberately (see its own doc comment: "no lip-sync — deliberate, not a
 * gap"); this goes one step further and actually moves the mouth, using the
 * exact same amplitude signal (audio-amplitude.ts) both providers already
 * compute.
 */
export function createVrmExpressionDriver(vrm: VRM, options: VrmExpressionDriverOptions = {}): VrmExpressionDriver {
  const gain = options.gain ?? DEFAULT_GAIN;

  return {
    setAmplitude(amplitude: number): void {
      const weight = Math.max(0, Math.min(1, amplitude * gain));
      vrm.expressionManager?.setValue(MOUTH_EXPRESSION, weight);
    },
    reset(): void {
      vrm.expressionManager?.setValue(MOUTH_EXPRESSION, 0);
    },
  };
}
