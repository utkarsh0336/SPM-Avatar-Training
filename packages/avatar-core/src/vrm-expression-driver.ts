import type { VRM } from "@pixiv/three-vrm";

export interface VrmExpressionDriverOptions {
  /** Multiplies raw amplitude (0..~1 RMS from audio-amplitude.ts) before clamping to the expression's 0..1 weight range. */
  gain?: number;
}

export interface VrmSpectrumBands {
  /** 0..1 average energy in the low frequency band (roughly <500Hz at a typical 48kHz TTS sample rate). */
  low: number;
  /** 0..1 average energy in the mid frequency band (roughly 500-2500Hz). */
  mid: number;
  /** 0..1 average energy in the high frequency band (roughly 2500-6000Hz). */
  high: number;
  /** 0..~1 RMS amplitude — same signal the old single-viseme driver used, still drives overall mouth-open-ness. */
  amplitude: number;
}

export interface VrmExpressionDriver {
  /** Drives a multi-viseme mouth shape from the current spectral balance of the speech signal. */
  setSpectrum(bands: VrmSpectrumBands): void;
  /** Zeroes every viseme weight — call on interrupt/stop so a barge-in doesn't leave the mouth stuck open. */
  reset(): void;
}

const VISEME_AA = "aa";
const VISEME_IH = "ih";
const VISEME_OU = "ou";
const VISEME_EE = "ee";
const VISEME_OH = "oh";
const VISEMES = [VISEME_AA, VISEME_IH, VISEME_OU, VISEME_EE, VISEME_OH] as const;
type Viseme = (typeof VISEMES)[number];

const DEFAULT_GAIN = 2.2;
// Per-call blend rates toward the target weight (not a real fixed-timestep
// filter — this driver has no delta-time input, only a per-audio-frame
// call cadence from audio-amplitude.ts's startAudioSpectrumLoop). Attack is
// faster than release so a new viseme snaps in quickly but a released one
// fades out smoothly instead of chattering between frames.
const ATTACK_RATE = 0.6;
const RELEASE_RATE = 0.25;

/**
 * Drives a VRM's viseme blend shapes from a live spectral signal — a
 * multi-viseme SPECTRAL APPROXIMATION, not phoneme-accurate lip sync (that
 * needs real viseme/word-boundary timing from the TTS layer, which neither
 * tts-echogarden.ts (Piper) nor tts-msedge.ts currently emit through this
 * codebase's wrappers — a real TTS-provider integration project of its own,
 * not attempted here). What this DOES do, using only what
 * AnalyserNode.getByteFrequencyData() already gives for free: bucket the
 * live spectrum into low/mid/high energy bands (audio-amplitude.ts's
 * startAudioSpectrumLoop) and pick whichever of the five VRM viseme presets
 * (aa/ih/ou/ee/oh) best matches that spectral shape each frame — open
 * vowels are bass-heavy (aa), rounded vowels carry mid-formant energy
 * (ou/oh), spread vowels carry high-band energy (ee/ih). Only the single
 * best-matching viseme is driven up at a time; blending several at once
 * reads as a blurry mouth shape, not a real one.
 */
export function createVrmExpressionDriver(vrm: VRM, options: VrmExpressionDriverOptions = {}): VrmExpressionDriver {
  const gain = options.gain ?? DEFAULT_GAIN;
  const current: Record<Viseme, number> = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  // Reused across every call and overwritten in place rather than allocating
  // a fresh object per call — setSpectrum runs once per rAF tick for the
  // full duration of every spoken utterance.
  const shapeWeights: Record<Viseme, number> = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

  function setWeight(name: Viseme, weight: number): void {
    vrm.expressionManager?.setValue(name, weight);
  }

  return {
    setSpectrum({ low, mid, high, amplitude }: VrmSpectrumBands): void {
      const openness = Math.max(0, Math.min(1, amplitude * gain));

      shapeWeights.aa = low;
      shapeWeights.oh = Math.max(0, mid - high);
      shapeWeights.ou = Math.max(0, mid - low) * 0.7;
      shapeWeights.ee = Math.max(0, high - low);
      shapeWeights.ih = Math.max(0, high - mid) * 0.6;

      let dominant: Viseme = VISEME_AA;
      let dominantWeight = -Infinity;
      for (const viseme of VISEMES) {
        const weight = shapeWeights[viseme];
        if (weight > dominantWeight) {
          dominantWeight = weight;
          dominant = viseme;
        }
      }

      for (const viseme of VISEMES) {
        const target = viseme === dominant ? openness : 0;
        const rate = target > current[viseme] ? ATTACK_RATE : RELEASE_RATE;
        current[viseme] = current[viseme] + (target - current[viseme]) * rate;
        setWeight(viseme, current[viseme]);
      }
    },
    reset(): void {
      for (const viseme of VISEMES) {
        current[viseme] = 0;
        setWeight(viseme, 0);
      }
    },
  };
}
