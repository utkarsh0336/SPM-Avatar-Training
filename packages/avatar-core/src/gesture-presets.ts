/**
 * Data table for vrm-gesture-animator.ts — kept separate from the animator
 * itself so the actual gesture shapes are easy to find and retune after
 * visual review, same spirit as vrm-idle-animator.ts's named constants at
 * the top of that file.
 *
 * Bone ownership is partitioned by file: this table may only ever target
 * the arm/hand/torso bones below. head/neck are vrm-idle-animator.ts's, and
 * mouth/gaze expression presets belong to vrm-expression-driver.ts and
 * vrm-idle-animator.ts respectively — never referenced here.
 */

export type GesturePhase = "speaking" | "thinking" | "listening";

export type GestureBoneName =
  | "leftUpperArm"
  | "rightUpperArm"
  | "leftLowerArm"
  | "rightLowerArm"
  | "leftHand"
  | "rightHand"
  | "spine"
  | "chest";

/**
 * The only bones a gesture preset may target. leftUpperArm/rightUpperArm/
 * leftLowerArm/rightLowerArm are already used by vrm-rest-pose.ts.
 * leftHand/rightHand/spine are confirmed valid VRMRequiredHumanBoneNames
 * (present on every VRM in this repo's replica set) but unused elsewhere.
 * chest is a valid but OPTIONAL VRMHumanBoneName — not every replica has
 * one, so callers must null-guard it same as every other bone lookup here.
 */
export const GESTURE_BONE_NAMES: readonly GestureBoneName[] = [
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
  "spine",
  "chest",
];

/**
 * Rotation offset for one bone, applied on top of that bone's captured base
 * rotation at construction time — never an absolute rotation. `x`/`y` are
 * static holds only. `swayAmplitude`/`swayFrequencyHz`/`swayPhase` modulate
 * the `z` axis specifically — the arm-swing axis vrm-rest-pose.ts's own
 * rest-pose rotation already uses — added on top of any static `z` hold; a
 * hold-only bone (swayAmplitude 0 or omitted) reads as a fixed pose.
 */
export interface BoneOffset {
  x?: number;
  y?: number;
  z?: number;
  swayAmplitude?: number;
  swayFrequencyHz?: number;
  /** Radians; staggers left/right bones so they don't move in lockstep. */
  swayPhase?: number;
}

export type GesturePreset = Partial<Record<GestureBoneName, BoneOffset>>;

/**
 * Deliberately subtle — small offsets/amplitudes throughout. This is body
 * language, not a puppet show; the illustrative shapes here are a starting
 * point for visual tuning (see A5's manual verification pass), not a final
 * design. All angles in radians.
 */
export const GESTURE_PRESETS: Record<GesturePhase, GesturePreset> = {
  // Subtle alternating open-hand sway, as if gesturing through explanation.
  // Left/right arms and their lower-arm counter-motion are phase-offset by
  // Math.PI so they alternate rather than mirror each other exactly.
  speaking: {
    leftUpperArm: { swayAmplitude: 0.12, swayFrequencyHz: 0.35, swayPhase: 0 },
    rightUpperArm: { swayAmplitude: 0.12, swayFrequencyHz: 0.35, swayPhase: Math.PI },
    leftLowerArm: { swayAmplitude: 0.08, swayFrequencyHz: 0.35, swayPhase: Math.PI / 2 },
    rightLowerArm: { swayAmplitude: 0.08, swayFrequencyHz: 0.35, swayPhase: Math.PI / 2 + Math.PI },
  },
  // A held, approximate "considering the question" pose on one arm — right
  // upper arm raised and rotated in, lower arm bent up, hand near chest/chin
  // height. No hand-to-face IK; this is an approximation, not literal
  // finger-to-chin contact.
  thinking: {
    rightUpperArm: { z: 0.35, x: 0.15 },
    rightLowerArm: { z: 0.9 },
    rightHand: { x: 0.1 },
    spine: { x: 0.03 },
  },
  // Near rest — arms stay close to the pose vrm-rest-pose.ts already
  // applied. A slow, low-amplitude sway keeps the avatar from looking
  // frozen, deliberately at a different frequency/phase than
  // vrm-idle-animator.ts's head sway (elapsedS * 0.3) so the two motions
  // never read as synchronized.
  listening: {
    leftUpperArm: { swayAmplitude: 0.02, swayFrequencyHz: 0.11, swayPhase: 0 },
    rightUpperArm: { swayAmplitude: 0.02, swayFrequencyHz: 0.11, swayPhase: Math.PI },
  },
};
