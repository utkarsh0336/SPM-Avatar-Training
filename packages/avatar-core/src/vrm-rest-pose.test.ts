import { describe, expect, it, vi } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import { applyRestPose } from "./vrm-rest-pose.js";

function createFakeBone() {
  return { rotation: { set: vi.fn(), x: 0, y: 0, z: 0 } };
}

function createFakeVrm() {
  const leftUpperArm = createFakeBone();
  const rightUpperArm = createFakeBone();
  const leftLowerArm = createFakeBone();
  const rightLowerArm = createFakeBone();
  const getNormalizedBoneNode = vi.fn((name: string) => {
    switch (name) {
      case "leftUpperArm":
        return leftUpperArm;
      case "rightUpperArm":
        return rightUpperArm;
      case "leftLowerArm":
        return leftLowerArm;
      case "rightLowerArm":
        return rightLowerArm;
      default:
        return null;
    }
  });
  const vrm = { humanoid: { getNormalizedBoneNode } } as unknown as VRM;
  return { vrm, leftUpperArm, rightUpperArm, leftLowerArm, rightLowerArm };
}

describe("applyRestPose", () => {
  it("rotates the upper arms down from a T-pose, mirrored left/right", () => {
    const { vrm, leftUpperArm, rightUpperArm } = createFakeVrm();

    applyRestPose(vrm);

    expect(leftUpperArm.rotation.set).toHaveBeenCalledTimes(1);
    expect(rightUpperArm.rotation.set).toHaveBeenCalledTimes(1);
    const [, , leftZ] = leftUpperArm.rotation.set.mock.calls[0]!;
    const [, , rightZ] = rightUpperArm.rotation.set.mock.calls[0]!;
    expect(leftZ).toBeLessThan(0);
    expect(rightZ).toBeGreaterThan(0);
    expect(rightZ).toBeCloseTo(-leftZ); // mirrored magnitude
  });

  it("applies a slight, mirrored elbow bend", () => {
    const { vrm, leftLowerArm, rightLowerArm } = createFakeVrm();

    applyRestPose(vrm);

    const [, , leftZ] = leftLowerArm.rotation.set.mock.calls[0]!;
    const [, , rightZ] = rightLowerArm.rotation.set.mock.calls[0]!;
    expect(leftZ).toBeLessThan(0);
    expect(rightZ).toBeGreaterThan(0);
    // Elbow bend should be much smaller than the shoulder rotation.
    expect(Math.abs(leftZ as number)).toBeLessThan(Math.PI / 4);
  });

  it("does not throw when the VRM has no humanoid or the bones are missing", () => {
    const vrmWithNoHumanoid = {} as unknown as VRM;
    expect(() => applyRestPose(vrmWithNoHumanoid)).not.toThrow();

    const vrmWithMissingBones = {
      humanoid: { getNormalizedBoneNode: vi.fn(() => null) },
    } as unknown as VRM;
    expect(() => applyRestPose(vrmWithMissingBones)).not.toThrow();
  });
});
