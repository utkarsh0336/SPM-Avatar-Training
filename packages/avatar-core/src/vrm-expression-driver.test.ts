import { describe, expect, it, vi } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import { createVrmExpressionDriver } from "./vrm-expression-driver.js";

function createFakeVrm() {
  const setValue = vi.fn();
  return { vrm: { expressionManager: { setValue } } as unknown as VRM, setValue };
}

describe("createVrmExpressionDriver", () => {
  it("setAmplitude() sets the aa mouth expression proportional to amplitude", () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmExpressionDriver(vrm, { gain: 2 });

    driver.setAmplitude(0.3);

    expect(setValue).toHaveBeenCalledWith("aa", 0.6);
  });

  it("clamps the weight to [0, 1] even for a very loud amplitude", () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmExpressionDriver(vrm, { gain: 5 });

    driver.setAmplitude(1);

    expect(setValue).toHaveBeenCalledWith("aa", 1);
  });

  it("reset() zeroes the mouth expression", () => {
    const { vrm, setValue } = createFakeVrm();
    const driver = createVrmExpressionDriver(vrm);

    driver.reset();

    expect(setValue).toHaveBeenCalledWith("aa", 0);
  });

  it("does not throw when the VRM has no expressionManager", () => {
    const vrm = {} as unknown as VRM;
    const driver = createVrmExpressionDriver(vrm);
    expect(() => driver.setAmplitude(0.5)).not.toThrow();
    expect(() => driver.reset()).not.toThrow();
  });
});
