import { describe, expect, it, vi } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import { createVrmIdleAnimator } from "./vrm-idle-animator.js";

function createFakeVrm() {
  const setValue = vi.fn();
  const headBone = { rotation: { x: 0.1, y: -0.2, z: 0 } };
  const neckBone = { rotation: { x: 0, y: 0.05, z: 0 } };
  const getNormalizedBoneNode = vi.fn((name: string) => {
    if (name === "head") return headBone;
    if (name === "neck") return neckBone;
    return null;
  });
  const vrm = {
    expressionManager: { setValue },
    humanoid: { getNormalizedBoneNode },
  } as unknown as VRM;
  return { vrm, setValue, headBone, neckBone };
}

// Fixed-step clock: each call to now() advances by `stepMs`, starting at 0.
function createFakeClock(stepMs: number) {
  let current = -stepMs; // first tick() call establishes the baseline (deltaS=0)
  return () => {
    current += stepMs;
    return current;
  };
}

describe("createVrmIdleAnimator", () => {
  it("blinks after the (deterministic) scheduled interval, then closes back to 0", () => {
    const { vrm, setValue } = createFakeVrm();
    // random() always 0.5 -> nextBlinkAtS = 2.5 + 0.5*(6-2.5) = 4.25s
    const animator = createVrmIdleAnimator(vrm, { random: () => 0.5, now: createFakeClock(1000) });

    // First tick establishes baseline (deltaS=0), no blink expected yet.
    animator.tick();
    setValue.mockClear();

    // Advance to just before 4.25s — still waiting.
    for (let i = 0; i < 3; i++) animator.tick(); // elapsed: 1,2,3s
    expect(setValue).not.toHaveBeenCalledWith("blink", expect.any(Number));

    // Advance well past the threshold — each 1s tick can only advance the
    // blink state machine by one phase (waiting->in->hold->out->waiting) at
    // this coarse a step size, so give it enough ticks to complete the
    // whole cycle rather than asserting on an exact tick count.
    for (let i = 0; i < 10; i++) animator.tick();

    const blinkCalls = setValue.mock.calls.filter(([name]) => name === "blink");
    expect(blinkCalls.length).toBeGreaterThan(0);
    expect(blinkCalls.some(([, weight]) => (weight as number) > 0.9)).toBe(true); // it actually closed the eye at some point
    expect(blinkCalls[blinkCalls.length - 1]).toEqual(["blink", 0]); // and reopened by the end
  });

  it("reset() immediately zeroes blink and every gaze expression", () => {
    const { vrm, setValue } = createFakeVrm();
    const animator = createVrmIdleAnimator(vrm);

    animator.reset();

    expect(setValue).toHaveBeenCalledWith("blink", 0);
    expect(setValue).toHaveBeenCalledWith("lookLeft", 0);
    expect(setValue).toHaveBeenCalledWith("lookRight", 0);
    expect(setValue).toHaveBeenCalledWith("lookUp", 0);
    expect(setValue).toHaveBeenCalledWith("lookDown", 0);
  });

  it("applies head sway relative to the bone's captured base rotation, never accumulating", () => {
    const { vrm, headBone } = createFakeVrm();
    const baseY = headBone.rotation.y;
    const animator = createVrmIdleAnimator(vrm, { random: () => 0.9, now: createFakeClock(100) });

    for (let i = 0; i < 20; i++) animator.tick();

    // Offset stays small and centered on the captured base, not drifting.
    expect(Math.abs(headBone.rotation.y - baseY)).toBeLessThanOrEqual(0.02 + 1e-9);
  });

  it("does not throw when the VRM has no expressionManager or humanoid", () => {
    const vrm = {} as unknown as VRM;
    const animator = createVrmIdleAnimator(vrm, { now: createFakeClock(1000) });
    expect(() => {
      for (let i = 0; i < 5; i++) animator.tick();
      animator.reset();
    }).not.toThrow();
  });

  it("gaze weights move toward a picked target over time (never a single-frame jump)", () => {
    const { vrm, setValue } = createFakeVrm();
    // random() always 0.5 -> picks "lookUp" (index floor(0.5*4)=2), weight 0.5*0.3=0.15,
    // nextGazePickAtS = 4 + 0.5*(9-4) = 6.5s
    const animator = createVrmIdleAnimator(vrm, { random: () => 0.5, now: createFakeClock(1000) });

    for (let i = 0; i < 7; i++) animator.tick(); // elapsed: 0..6s, crosses 6.5s isn't reached yet at i=6 (6s)
    setValue.mockClear();
    animator.tick(); // elapsed: 7s -> past the 6.5s pick threshold, lookUp target now active

    const lookUpCalls = setValue.mock.calls.filter(([name]) => name === "lookUp");
    expect(lookUpCalls.length).toBeGreaterThan(0);
    const lastWeight = lookUpCalls[lookUpCalls.length - 1]![1] as number;
    // Smoothed toward 0.15 but with a 1s step against a 1.5s smoothing window,
    // it should not have jumped instantly to the full target.
    expect(lastWeight).toBeGreaterThan(0);
    expect(lastWeight).toBeLessThanOrEqual(0.15 + 1e-9);
  });
});
