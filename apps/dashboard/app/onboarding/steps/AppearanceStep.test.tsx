import { describe, expect, it } from "vitest";
import { AppearanceStep } from "./AppearanceStep";

describe("AppearanceStep", () => {
  it("exports a component", () => {
    expect(typeof AppearanceStep).toBe("function");
  });
});
