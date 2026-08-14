import type { VRM } from "@pixiv/three-vrm";
import type { AvatarConversationPhase } from "./index.js";
import { GESTURE_BONE_NAMES, GESTURE_PRESETS, type GestureBoneName, type GesturePhase } from "./gesture-presets.js";

export interface VrmGestureAnimatorOptions {
  /** Injectable for deterministic tests; defaults to performance.now. */
  now?: () => number;
}

export interface VrmGestureAnimator {
  /** Selects the active gesture preset; any phase outside speaking/thinking rests at "listening". */
  setPhase(phase: AvatarConversationPhase): void;
  /** Call once per rendered frame — computes its own delta internally via `now`. */
  tick(): void;
  /**
   * Immediately zeroes every owned bone back to its captured base rotation.
   * Call from stop()/teardown only — deliberately NOT called on interrupt()/
   * barge-in, same contract vrm-idle-animator.ts documents: body language is
   * about the avatar looking alive, independent of speech state.
   */
  reset(): void;
}

// How quickly the applied offset eases toward the active preset's target —
// low-pass filtered every tick exactly like vrm-idle-animator.ts's gaze
// smoothing, so a phase change (setPhase) crossfades rather than pops, with
// no separate blend-weight state needed: the smoothing itself produces the
// crossfade. Snappier than idle's 1.5s gaze smoothing (GAZE_SMOOTHING_S)
// since a gesture phase change is a much rarer, more deliberate event that
// should read as a clear reaction, not a slow drift.
const GESTURE_SMOOTHING_S = 0.4;

function resolveGesturePhase(phase: AvatarConversationPhase): GesturePhase {
  if (phase === "speaking") return "speaking";
  if (phase === "thinking") return "thinking";
  // connecting/listening/error/ended all rest at the same near-idle preset.
  return "listening";
}

interface TrackedBone {
  node: { rotation: { x: number; y: number; z: number } };
  base: { x: number; y: number; z: number };
  applied: { x: number; y: number; z: number };
}

/**
 * Arm/hand/torso body-language animator for an idle-or-talking VRM avatar —
 * the other half of the "human facial expressions and gestures" gap
 * vrm-idle-animator.ts's own comment names (that file covers blink/gaze/
 * head-sway only). Driven by conversation phase via setPhase(), not polled —
 * packages/realtime-core/src/conversation-session.ts calls this through
 * AvatarProvider.setPhase? alongside its existing onStatusChange callback.
 *
 * Bone ownership is partitioned by file: this animator only ever reads/
 * writes the bones in gesture-presets.ts's GESTURE_BONE_NAMES, and never
 * touches vrm-idle-animator.ts's head/neck bones or blink/gaze expression
 * names — see gesture-presets.test.ts for the static guard on the data
 * side, and this file's own test suite for the runtime guard.
 */
export function createVrmGestureAnimator(vrm: VRM, options: VrmGestureAnimatorOptions = {}): VrmGestureAnimator {
  const now = options.now ?? (() => performance.now());

  let lastTimeMs: number | null = null;
  let elapsedS = 0;
  let activePhase: GesturePhase = "listening";

  // Captured once, at construction — after vrm-loader.ts's applyRestPose()
  // has already run, so "base" here already includes the rest-pose rotation.
  // Offsets below are always relative to this, never accumulated, same
  // invariant vrm-idle-animator.ts and vrm-rest-pose.ts both document.
  const bones = new Map<GestureBoneName, TrackedBone>();
  for (const name of GESTURE_BONE_NAMES) {
    const node = vrm.humanoid?.getNormalizedBoneNode(name);
    if (!node) continue; // e.g. optional "chest" absent on some replicas
    bones.set(name, {
      node,
      base: { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z },
      applied: { x: 0, y: 0, z: 0 },
    });
  }

  // targetX/Y/Z are written by targetFor() and read back by the caller —
  // a reused scratch triple instead of returning a fresh { x, y, z }
  // literal every call. tick() runs once per rendered frame (up to 60Hz)
  // over up to 8 tracked bones, so this was up to ~480 short-lived
  // allocations/sec purely for GC to reclaim; a latency review flagged the
  // resulting GC pressure as real frame-time risk on lower-end hardware.
  let targetX = 0;
  let targetY = 0;
  let targetZ = 0;
  function targetFor(name: GestureBoneName): void {
    const offset = GESTURE_PRESETS[activePhase][name];
    if (!offset) {
      targetX = 0;
      targetY = 0;
      targetZ = 0;
      return;
    }
    const sway =
      offset.swayAmplitude && offset.swayFrequencyHz
        ? offset.swayAmplitude * Math.sin(2 * Math.PI * offset.swayFrequencyHz * elapsedS + (offset.swayPhase ?? 0))
        : 0;
    targetX = offset.x ?? 0;
    targetY = offset.y ?? 0;
    targetZ = (offset.z ?? 0) + sway;
  }

  return {
    setPhase(phase: AvatarConversationPhase): void {
      activePhase = resolveGesturePhase(phase);
    },
    tick(): void {
      const t = now();
      const deltaS = lastTimeMs === null ? 0 : Math.max(0, (t - lastTimeMs) / 1000);
      lastTimeMs = t;
      elapsedS += deltaS;

      const smoothingFactor = deltaS <= 0 ? 0 : Math.min(1, deltaS / GESTURE_SMOOTHING_S);

      for (const [name, bone] of bones) {
        targetFor(name);
        bone.applied.x += (targetX - bone.applied.x) * smoothingFactor;
        bone.applied.y += (targetY - bone.applied.y) * smoothingFactor;
        bone.applied.z += (targetZ - bone.applied.z) * smoothingFactor;
        bone.node.rotation.x = bone.base.x + bone.applied.x;
        bone.node.rotation.y = bone.base.y + bone.applied.y;
        bone.node.rotation.z = bone.base.z + bone.applied.z;
      }
    },
    reset(): void {
      activePhase = "listening";
      lastTimeMs = null;
      elapsedS = 0;
      for (const bone of bones.values()) {
        bone.applied = { x: 0, y: 0, z: 0 };
        bone.node.rotation.x = bone.base.x;
        bone.node.rotation.y = bone.base.y;
        bone.node.rotation.z = bone.base.z;
      }
    },
  };
}
