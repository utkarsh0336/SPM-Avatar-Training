import { describe, expect, it, vi } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import { createVrmExpressionDriver } from "./vrm-expression-driver.js";

function createFakeVrm() {
  const setValue = vi.fn();
  return { vrm: { expressionManager: { setValue } } as unknown as VRM, setValue };
}

function lastWeightFor(setValue: ReturnType<typeof vi.fn>, name: string): number | undefined {
  const calls = setValue.mock.calls.filter((call) => call[0] === name);
  return calls.length ? (calls[calls.length - 1]![1] as number) : undefined;
}

describe("createVrmExpressionDriver", () => {
  it("drives the aa viseme up when low-band energy dominates (open vowel shape)", () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmExpressionDriver(vrm, { gain: 2 });

    // Several calls so the attack-rate blend converges close to the target.
    for (let i = 0; i < 10; i++) driver.setSpectrum({ low: 0.8, mid: 0.1, high: 0.05, amplitude: 0.5 });

    expect(lastWeightFor(setValue, "aa")).toBeGreaterThan(0.5);
    expect(lastWeightFor(setValue, "ee")).toBeCloseTo(0, 1);
  });

  it("drives the ee viseme up when high-band energy dominates (spread vowel shape)", () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmExpressionDriver(vrm, { gain: 2 });

    for (let i = 0; i < 10; i++) driver.setSpectrum({ low: 0.05, mid: 0.1, high: 0.8, amplitude: 0.5 });

    expect(lastWeightFor(setValue, "ee")).toBeGreaterThan(0.5);
    expect(lastWeightFor(setValue, "aa")).toBeCloseTo(0, 1);
  });

  it("clamps mouth openness to [0, 1] even for a very loud amplitude", () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmExpressionDriver(vrm, { gain: 5 });

    for (let i = 0; i < 10; i++) driver.setSpectrum({ low: 1, mid: 0, high: 0, amplitude: 1 });

    expect(lastWeightFor(setValue, "aa")).toBeLessThanOrEqual(1);
  });

  it("only drives one dominant viseme at a time, decaying the others toward 0", () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmExpressionDriver(vrm, { gain: 2 });

    for (let i = 0; i < 10; i++) driver.setSpectrum({ low: 0.9, mid: 0.05, high: 0.05, amplitude: 0.6 });
    setValue.mockClear();
    driver.setSpectrum({ low: 0.9, mid: 0.05, high: 0.05, amplitude: 0.6 });

    const weights = ["aa", "ih", "ou", "ee", "oh"].map((name) => lastWeightFor(setValue, name) ?? 0);
    const nonDominant = weights.filter((w) => w !== Math.max(...weights));
    expect(nonDominant.every((w) => w < weights[0]!)).toBe(true);
  });

  it("reset() zeroes every viseme weight", () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmExpressionDriver(vrm);

    driver.reset();

    for (const name of ["aa", "ih", "ou", "ee", "oh"]) {
      expect(setValue).toHaveBeenCalledWith(name, 0);
    }
  });

  it("does not throw when the VRM has no expressionManager", () => {
    const vrm = {} as unknown as VRM;
    const driver = createVrmExpressionDriver(vrm);
    expect(() => driver.setSpectrum({ low: 0.5, mid: 0.5, high: 0.5, amplitude: 0.5 })).not.toThrow();
    expect(() => driver.reset()).not.toThrow();
  });
});
