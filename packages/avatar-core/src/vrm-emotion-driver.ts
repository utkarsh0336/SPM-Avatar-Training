import type { VRM } from "@pixiv/three-vrm";
import type { AvatarEmotion } from "./index.js";

export interface VrmEmotionDriverOptions {
  /** Injectable for deterministic tests; defaults to performance.now. */
  now?: () => number;
}

export interface VrmEmotionDriver {
  /** Crossfades toward the given emotion's VRM expression preset ("neutral" fades whatever's active back out). */
  setEmotion(emotion: AvatarEmotion): void;
  /** Call once per rendered frame — advances the crossfade. */
  tick(): void;
  /** Immediately zeroes the active expression — call on interrupt()/stop(). */
  reset(): void;
}

// Subtle, not cartoonish — a corporate trainer avatar shouldn't overact.
const HOLD_WEIGHT = 0.55;
const FADE_IN_MS = 250;
const FADE_OUT_MS = 400;

/**
 * SOW §3.1 "emotion-aware interaction" — crossfades a VRM emotion preset
 * (happy/sad/surprised; "angry"/"relaxed" are deliberately never used, see
 * tutor/emotion.ts) in response to the server's per-turn classifyEmotion
 * result. Only one emotion is ever active at a time: switching to a
 * different emotion mid-hold hard-cuts the previous preset's weight to 0
 * (turns are seconds apart — no perceptible pop) rather than cross-blending
 * two different expressions, which is both simpler and reads correctly.
 */
export function createVrmEmotionDriver(vrm: VRM, options: VrmEmotionDriverOptions = {}): VrmEmotionDriver {
  const now = options.now ?? (() => performance.now());

  let activeName: Exclude<AvatarEmotion, "neutral"> | null = null;
  let weight = 0;
  let targetWeight = 0;
  let lastTickMs: number | null = null;

  function setExpression(name: string, w: number): void {
    vrm.expressionManager?.setValue(name, w);
  }

  return {
    setEmotion(emotion: AvatarEmotion): void {
      if (emotion === "neutral") {
        targetWeight = 0;
        return;
      }
      if (activeName && activeName !== emotion) {
        setExpression(activeName, 0);
      }
      activeName = emotion;
      targetWeight = HOLD_WEIGHT;
      lastTickMs = null; // restart delta timing so the fade-in starts clean
    },
    tick(): void {
      if (activeName === null && weight === 0) return;
      const t = now();
      const deltaMs = lastTickMs === null ? 0 : Math.max(0, t - lastTickMs);
      lastTickMs = t;

      const fadeMs = targetWeight > weight ? FADE_IN_MS : FADE_OUT_MS;
      const step = Math.min(1, fadeMs <= 0 ? 1 : deltaMs / fadeMs);
      weight += (targetWeight - weight) * step;

      if (activeName) setExpression(activeName, weight);

      if (targetWeight === 0 && weight < 0.01) {
        if (activeName) setExpression(activeName, 0);
        weight = 0;
        activeName = null;
        lastTickMs = null;
      }
    },
    reset(): void {
      if (activeName) setExpression(activeName, 0);
      activeName = null;
      weight = 0;
      targetWeight = 0;
      lastTickMs = null;
    },
  };
}
