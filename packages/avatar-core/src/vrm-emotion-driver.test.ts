import { describe, expect, it, vi } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import { createVrmEmotionDriver } from "./vrm-emotion-driver.js";

function createFakeVrm() {
  const setValue = vi.fn();
  return { vrm: { expressionManager: { setValue } } as unknown as VRM, setValue };
}

function createFakeClock(stepMs: number) {
  let current = -stepMs;
  return () => {
    current += stepMs;
    return current;
  };
}

function lastWeightFor(setValue: ReturnType<typeof vi.fn>, name: string): number | undefined {
  const calls = setValue.mock.calls.filter((call) => call[0] === name);
  return calls.length ? (calls[calls.length - 1]![1] as number) : undefined;
}

describe("createVrmEmotionDriver", () => {
  it("fades the target emotion's expression up toward the hold weight over successive ticks", () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmEmotionDriver(vrm, { now: createFakeClock(50) });

    driver.setEmotion("happy");
    for (let i = 0; i < 10; i++) driver.tick();

    const weight = lastWeightFor(setValue, "happy");
    expect(weight).toBeGreaterThan(0);
    expect(weight!).toBeLessThanOrEqual(0.6); // subtle hold weight, never a cartoonish full 1
  });

  it('setEmotion("neutral") fades whatever is active back down to 0', () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmEmotionDriver(vrm, { now: createFakeClock(50) });

    driver.setEmotion("happy");
    for (let i = 0; i < 10; i++) driver.tick();
    expect(lastWeightFor(setValue, "happy")).toBeGreaterThan(0);

    setValue.mockClear();
    driver.setEmotion("neutral");
    for (let i = 0; i < 30; i++) driver.tick();

    expect(lastWeightFor(setValue, "happy")).toBe(0);
  });

  it("switching to a different emotion mid-hold hard-cuts the previous one to 0", () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmEmotionDriver(vrm, { now: createFakeClock(50) });

    driver.setEmotion("happy");
    for (let i = 0; i < 5; i++) driver.tick();
    setValue.mockClear();

    driver.setEmotion("sad");

    expect(setValue).toHaveBeenCalledWith("happy", 0);
  });

  it("reset() immediately zeroes the active expression", () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmEmotionDriver(vrm, { now: createFakeClock(50) });

    driver.setEmotion("surprised");
    for (let i = 0; i < 5; i++) driver.tick();

    driver.reset();

    expect(setValue).toHaveBeenLastCalledWith("surprised", 0);
  });

  it("does not throw when the VRM has no expressionManager", () => {
    const vrm = {} as unknown as VRM;
    const driver = createVrmEmotionDriver(vrm, { now: createFakeClock(50) });
    expect(() => {
      driver.setEmotion("happy");
      for (let i = 0; i < 5; i++) driver.tick();
      driver.reset();
    }).not.toThrow();
  });

  it("tick() before any setEmotion() call is a no-op", () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmEmotionDriver(vrm, { now: createFakeClock(50) });

    driver.tick();
    driver.tick();

    expect(setValue).not.toHaveBeenCalled();
  });
});
