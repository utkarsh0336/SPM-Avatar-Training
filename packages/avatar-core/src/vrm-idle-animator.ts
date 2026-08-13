import type { VRM } from "@pixiv/three-vrm";

export interface VrmIdleAnimatorOptions {
  /** Injectable for deterministic tests; defaults to Math.random. */
  random?: () => number;
  /** Injectable for deterministic tests; defaults to performance.now. */
  now?: () => number;
}

export interface VrmIdleAnimator {
  /** Call once per rendered frame — computes its own delta internally via `now`. */
  tick(): void;
  /**
   * Zeroes blink + gaze expression weights immediately. Call from stop()/
   * teardown only — deliberately NOT called on interrupt()/barge-in: idle
   * motion is about the avatar looking alive, independent of speech state.
   */
  reset(): void;
}

const BLINK_EXPRESSION = "blink";
const GAZE_EXPRESSIONS = ["lookLeft", "lookRight", "lookUp", "lookDown"] as const;
type GazeExpression = (typeof GAZE_EXPRESSIONS)[number];

const BLINK_MIN_INTERVAL_S = 2.5;
const BLINK_MAX_INTERVAL_S = 6;
const BLINK_RAMP_IN_S = 0.06;
const BLINK_HOLD_S = 0.04;
const BLINK_RAMP_OUT_S = 0.09;

const GAZE_MIN_INTERVAL_S = 4;
const GAZE_MAX_INTERVAL_S = 9;
const GAZE_MAX_WEIGHT = 0.3;
const GAZE_SMOOTHING_S = 1.5;

// Low-amplitude sine offsets applied relative to each bone's own base
// rotation (captured once at construction) — never accumulated, so this can
// never drift the head off-model over a long session.
const HEAD_SWAY_AMPLITUDE_Y = 0.02;
const HEAD_SWAY_AMPLITUDE_X = 0.015;
const NECK_SWAY_AMPLITUDE_Y = HEAD_SWAY_AMPLITUDE_Y * 0.5;

function randomBetween(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

/**
 * Blink + gaze-drift + subtle head sway for an idle VRM avatar — the "human
 * facial expressions and gestures" gap from SOW §3.1. Every preset name used
 * here (blink, lookLeft/Right/Up/Down) and the humanoid bone accessor
 * (vrm.humanoid.getNormalizedBoneNode) come from @pixiv/three-vrm-core,
 * already a dependency — no new package needed.
 *
 * Coexists with vrm-expression-driver.ts's viseme weights and
 * vrm-avatar-provider.ts's emotion presets: VRM expressions are independent
 * named slots that blend additively via expressionManager.setValue(name, w),
 * so as long as each system only ever writes its own preset names there's no
 * conflict.
 */
export function createVrmIdleAnimator(vrm: VRM, options: VrmIdleAnimatorOptions = {}): VrmIdleAnimator {
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => performance.now());

  let lastTimeMs: number | null = null;
  let elapsedS = 0;

  type BlinkPhase = "waiting" | "in" | "hold" | "out";
  let blinkPhase: BlinkPhase = "waiting";
  let blinkPhaseElapsedS = 0;
  let nextBlinkAtS = randomBetween(random, BLINK_MIN_INTERVAL_S, BLINK_MAX_INTERVAL_S);

  const gazeCurrent: Record<GazeExpression, number> = { lookLeft: 0, lookRight: 0, lookUp: 0, lookDown: 0 };
  let gazeTarget: GazeExpression | null = null;
  let gazeTargetWeight = 0;
  let nextGazePickAtS = randomBetween(random, GAZE_MIN_INTERVAL_S, GAZE_MAX_INTERVAL_S);

  const headBone = vrm.humanoid?.getNormalizedBoneNode("head") ?? null;
  const neckBone = vrm.humanoid?.getNormalizedBoneNode("neck") ?? null;
  const headBaseRotation = headBone ? { x: headBone.rotation.x, y: headBone.rotation.y } : null;
  const neckBaseRotation = neckBone ? { y: neckBone.rotation.y } : null;

  function setExpression(name: string, weight: number): void {
    vrm.expressionManager?.setValue(name, weight);
  }

  function tickBlink(deltaS: number): void {
    blinkPhaseElapsedS += deltaS;
    switch (blinkPhase) {
      case "waiting":
        if (elapsedS >= nextBlinkAtS) {
          blinkPhase = "in";
          blinkPhaseElapsedS = 0;
        }
        break;
      case "in": {
        const t = Math.min(1, blinkPhaseElapsedS / BLINK_RAMP_IN_S);
        setExpression(BLINK_EXPRESSION, t);
        if (t >= 1) {
          blinkPhase = "hold";
          blinkPhaseElapsedS = 0;
        }
        break;
      }
      case "hold":
        if (blinkPhaseElapsedS >= BLINK_HOLD_S) {
          blinkPhase = "out";
          blinkPhaseElapsedS = 0;
        }
        break;
      case "out": {
        const t = Math.min(1, blinkPhaseElapsedS / BLINK_RAMP_OUT_S);
        setExpression(BLINK_EXPRESSION, 1 - t);
        if (t >= 1) {
          blinkPhase = "waiting";
          blinkPhaseElapsedS = 0;
          nextBlinkAtS = elapsedS + randomBetween(random, BLINK_MIN_INTERVAL_S, BLINK_MAX_INTERVAL_S);
        }
        break;
      }
    }
  }

  function tickGaze(deltaS: number): void {
    if (elapsedS >= nextGazePickAtS) {
      if (gazeTarget) {
        // Was looking somewhere — drift back to neutral before the next pick.
        gazeTarget = null;
        gazeTargetWeight = 0;
      } else {
        gazeTarget = GAZE_EXPRESSIONS[Math.floor(random() * GAZE_EXPRESSIONS.length)]!;
        gazeTargetWeight = random() * GAZE_MAX_WEIGHT;
      }
      nextGazePickAtS = elapsedS + randomBetween(random, GAZE_MIN_INTERVAL_S, GAZE_MAX_INTERVAL_S);
    }

    const smoothingFactor = deltaS <= 0 ? 0 : Math.min(1, deltaS / GAZE_SMOOTHING_S);
    for (const expr of GAZE_EXPRESSIONS) {
      const target = expr === gazeTarget ? gazeTargetWeight : 0;
      gazeCurrent[expr] += (target - gazeCurrent[expr]) * smoothingFactor;
      setExpression(expr, gazeCurrent[expr]);
    }
  }

  function tickHeadSway(): void {
    if (headBone && headBaseRotation) {
      headBone.rotation.y = headBaseRotation.y + Math.sin(elapsedS * 0.3) * HEAD_SWAY_AMPLITUDE_Y;
      headBone.rotation.x = headBaseRotation.x + Math.sin(elapsedS * 0.21 + 1) * HEAD_SWAY_AMPLITUDE_X;
    }
    if (neckBone && neckBaseRotation) {
      neckBone.rotation.y = neckBaseRotation.y + Math.sin(elapsedS * 0.3 + 0.5) * NECK_SWAY_AMPLITUDE_Y;
    }
  }

  return {
    tick(): void {
      const t = now();
      const deltaS = lastTimeMs === null ? 0 : Math.max(0, (t - lastTimeMs) / 1000);
      lastTimeMs = t;
      elapsedS += deltaS;

      tickBlink(deltaS);
      tickGaze(deltaS);
      tickHeadSway();
    },
    reset(): void {
      blinkPhase = "waiting";
      blinkPhaseElapsedS = 0;
      setExpression(BLINK_EXPRESSION, 0);
      for (const expr of GAZE_EXPRESSIONS) {
        gazeCurrent[expr] = 0;
        setExpression(expr, 0);
      }
      gazeTarget = null;
      gazeTargetWeight = 0;
    },
  };
}
