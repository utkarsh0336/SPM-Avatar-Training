import { describe, expect, it } from "vitest";
import { OutfitStep } from "./OutfitStep";

describe("OutfitStep", () => {
  it("exports a component", () => {
    expect(typeof OutfitStep).toBe("function");
  });
});
