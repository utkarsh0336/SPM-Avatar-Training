import { describe, expect, it, vi } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import { createVrmGestureAnimator } from "./vrm-gesture-animator.js";
import { GESTURE_BONE_NAMES } from "./gesture-presets.js";

const IDLE_OWNED_BONE_NAMES = ["head", "neck"];
const IDLE_OWNED_EXPRESSION_NAMES = ["blink", "lookLeft", "lookRight", "lookUp", "lookDown"];

function createFakeVrm() {
  const setValue = vi.fn();
  const boneNodes = new Map(
    GESTURE_BONE_NAMES.filter((name) => name !== "chest").map((name) => [
      name,
      { rotation: { x: 0, y: 0, z: 0 } },
    ]),
  );
  // "chest" deliberately absent — it's an optional VRMHumanBoneName, not
  // every replica has one, so the animator must null-guard it like every
  // other bone lookup.
  const getNormalizedBoneNode = vi.fn((name: string) => boneNodes.get(name as never) ?? null);
  const vrm = {
    expressionManager: { setValue },
    humanoid: { getNormalizedBoneNode },
  } as unknown as VRM;
  return { vrm, setValue, getNormalizedBoneNode, boneNodes };
}

// Fixed-step clock: each call to now() advances by `stepMs`, starting at 0.
function createFakeClock(stepMs: number) {
  let current = -stepMs;
  return () => {
    current += stepMs;
    return current;
  };
}

describe("createVrmGestureAnimator", () => {
  it("never touches vrm-idle-animator-owned bones or expressions", () => {
    const { vrm, setValue, getNormalizedBoneNode } = createFakeVrm();
    const animator = createVrmGestureAnimator(vrm, { now: createFakeClock(200) });

    animator.setPhase("speaking");
    for (let i = 0; i < 10; i++) animator.tick();
    animator.setPhase("thinking");
    for (let i = 0; i < 10; i++) animator.tick();
    animator.reset();

    for (const disallowed of IDLE_OWNED_BONE_NAMES) {
      expect(getNormalizedBoneNode).not.toHaveBeenCalledWith(disallowed);
    }
    // The gesture animator drives bones directly, never VRM expressions —
    // it should never call expressionManager.setValue at all, let alone
    // with an idle-owned name.
    expect(setValue).not.toHaveBeenCalled();
    for (const disallowed of IDLE_OWNED_EXPRESSION_NAMES) {
      expect(setValue).not.toHaveBeenCalledWith(disallowed, expect.any(Number));
    }
  });

  it("eases arm bones toward the speaking preset's sway, offset from the captured base rotation", () => {
    const { vrm, boneNodes } = createFakeVrm();
    const leftUpperArm = boneNodes.get("leftUpperArm")!;
    leftUpperArm.rotation.z = -1.2; // simulate vrm-rest-pose.ts having already run
    const baseZ = leftUpperArm.rotation.z;

    const animator = createVrmGestureAnimator(vrm, { now: createFakeClock(100) });
    animator.setPhase("speaking");
    for (let i = 0; i < 30; i++) animator.tick(); // 3s of ticks — well past GESTURE_SMOOTHING_S (0.4s)

    // Offset from the base, not an absolute rotation, and within the
    // speaking preset's declared sway amplitude (0.12) plus smoothing slack.
    expect(Math.abs(leftUpperArm.rotation.z - baseZ)).toBeGreaterThan(0);
    expect(Math.abs(leftUpperArm.rotation.z - baseZ)).toBeLessThanOrEqual(0.12 + 1e-6);
  });

  it("eases back toward the base rotation when phase returns to listening", () => {
    const { vrm, boneNodes } = createFakeVrm();
    const rightUpperArm = boneNodes.get("rightUpperArm")!;
    const baseZ = rightUpperArm.rotation.z;

    const animator = createVrmGestureAnimator(vrm, { now: createFakeClock(100) });
    animator.setPhase("thinking");
    for (let i = 0; i < 20; i++) animator.tick();
    expect(Math.abs(rightUpperArm.rotation.z - baseZ)).toBeGreaterThan(0.1); // thinking holds a real offset

    animator.setPhase("listening");
    for (let i = 0; i < 40; i++) animator.tick(); // long enough to fully ease back down
    // listening's own preset has a tiny 0.02 sway — should be back near base,
    // well below thinking's much larger held offset.
    expect(Math.abs(rightUpperArm.rotation.z - baseZ)).toBeLessThan(0.05);
  });

  it("reset() immediately zeroes every owned bone back to its captured base rotation", () => {
    const { vrm, boneNodes } = createFakeVrm();
    const bases = new Map([...boneNodes].map(([name, node]) => [name, { ...node.rotation }]));

    const animator = createVrmGestureAnimator(vrm, { now: createFakeClock(100) });
    animator.setPhase("thinking");
    for (let i = 0; i < 20; i++) animator.tick();

    animator.reset();

    for (const [name, node] of boneNodes) {
      const base = bases.get(name)!;
      expect(node.rotation.x).toBeCloseTo(base.x);
      expect(node.rotation.y).toBeCloseTo(base.y);
      expect(node.rotation.z).toBeCloseTo(base.z);
    }
  });

  it("does not throw when the VRM has no expressionManager or humanoid", () => {
    const vrm = {} as unknown as VRM;
    const animator = createVrmGestureAnimator(vrm, { now: createFakeClock(1000) });
    expect(() => {
      animator.setPhase("speaking");
      for (let i = 0; i < 5; i++) animator.tick();
      animator.reset();
    }).not.toThrow();
  });

  it("does not throw when an optional bone (chest) is absent on the replica", () => {
    const { vrm } = createFakeVrm(); // "chest" is deliberately never in boneNodes
    const animator = createVrmGestureAnimator(vrm, { now: createFakeClock(100) });
    expect(() => {
      animator.setPhase("thinking");
      for (let i = 0; i < 10; i++) animator.tick();
    }).not.toThrow();
  });

  it("defaults to the listening preset for phases with no dedicated gesture (connecting/error/ended)", () => {
    const { vrm, boneNodes } = createFakeVrm();
    const leftUpperArm = boneNodes.get("leftUpperArm")!;
    const baseZ = leftUpperArm.rotation.z;

    const animator = createVrmGestureAnimator(vrm, { now: createFakeClock(100) });
    animator.setPhase("connecting");
    for (let i = 0; i < 30; i++) animator.tick();

    // listening's sway amplitude is 0.02 — well within a small bound, unlike
    // speaking (0.12) or thinking's held offset.
    expect(Math.abs(leftUpperArm.rotation.z - baseZ)).toBeLessThan(0.05);
  });
});
