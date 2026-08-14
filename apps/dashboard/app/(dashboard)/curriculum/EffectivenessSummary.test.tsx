import { describe, expect, it } from "vitest";
import { EffectivenessSummary } from "./EffectivenessSummary";

describe("EffectivenessSummary", () => {
  it("exports a component", () => {
    expect(typeof EffectivenessSummary).toBe("function");
  });
});
