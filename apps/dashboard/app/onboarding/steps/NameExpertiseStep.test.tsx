import { describe, expect, it } from "vitest";
import { NameExpertiseStep } from "./NameExpertiseStep";

describe("NameExpertiseStep", () => {
  it("exports a component", () => {
    expect(typeof NameExpertiseStep).toBe("function");
  });
});
