import { describe, expect, it } from "vitest";
import { GenderStep } from "./GenderStep";

describe("GenderStep", () => {
  it("exports a component", () => {
    expect(typeof GenderStep).toBe("function");
  });
});
