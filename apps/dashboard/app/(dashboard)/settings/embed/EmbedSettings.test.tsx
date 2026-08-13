import { describe, expect, it } from "vitest";
import { EmbedSettings } from "./EmbedSettings";

describe("EmbedSettings", () => {
  it("exports a component", () => {
    expect(typeof EmbedSettings).toBe("function");
  });
});
