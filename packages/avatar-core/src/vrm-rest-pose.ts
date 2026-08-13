import type { VRM } from "@pixiv/three-vrm";

// Rotation around each upper arm's local Z axis, in VRM's normalized bone
// space, bringing a straight-out T-pose arm down to a relaxed at-the-side
// stance. Signs are mirrored left/right; magnitude tuned so the upper arm
// ends up close to vertical (a T-pose starts horizontal) without swinging
// past the torso.
const UPPER_ARM_REST_ANGLE = Math.PI * (70 / 180);
// A slight elbow bend reads as a natural relaxed stance rather than a stiff
// straight arm.
const ELBOW_REST_ANGLE = Math.PI * (5 / 180);

/**
 * Every VRM asset in this repo's replica set (realistic/animated/
 * stylized_3d — see replicas.json) loads in its raw bind pose, which is a
 * T-pose (arms straight out to the sides): nothing anywhere in this
 * codebase ever posed the humanoid skeleton before this. vrm-loader.ts's
 * bust-framing camera crop hides the outstretched arms in a narrower
 * viewport, but a wider aspect ratio (most visibly, entering fullscreen —
 * see VideoChatSession.tsx's requestFullscreen()) reveals the arms cutting
 * across the whole frame. Rotates the upper arms (and slightly, the lower
 * arms) down to a natural rest pose once, right after load — the standard
 * fix for a humanoid glTF/VRM rig with no baked idle animation. Uses
 * getNormalizedBoneNode (not getRawBoneNode) specifically because VRM's
 * "normalized" bone space is defined to share one canonical rest
 * orientation across every humanoid model regardless of the underlying
 * mesh/rig's own quirks — the same reason vrm-idle-animator.ts's head/neck
 * sway uses it too — so this fixed rotation angle is portable across every
 * replica, not tuned per-model.
 */
export function applyRestPose(vrm: VRM): void {
  const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode("leftUpperArm");
  const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode("rightUpperArm");
  leftUpperArm?.rotation.set(0, 0, -UPPER_ARM_REST_ANGLE);
  rightUpperArm?.rotation.set(0, 0, UPPER_ARM_REST_ANGLE);

  const leftLowerArm = vrm.humanoid?.getNormalizedBoneNode("leftLowerArm");
  const rightLowerArm = vrm.humanoid?.getNormalizedBoneNode("rightLowerArm");
  leftLowerArm?.rotation.set(0, 0, -ELBOW_REST_ANGLE);
  rightLowerArm?.rotation.set(0, 0, ELBOW_REST_ANGLE);
}
