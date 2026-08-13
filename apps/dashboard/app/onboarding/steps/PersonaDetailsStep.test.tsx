import { describe, expect, it } from "vitest";
import { PersonaDetailsStep } from "./PersonaDetailsStep";

describe("PersonaDetailsStep", () => {
  it("exports a component", () => {
    expect(typeof PersonaDetailsStep).toBe("function");
  });
});
