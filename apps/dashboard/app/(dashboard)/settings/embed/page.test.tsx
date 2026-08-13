import { describe, expect, it } from "vitest";
import EmbedSettingsPage from "./page";

describe("embed settings page", () => {
  it("exports a page component", () => {
    expect(typeof EmbedSettingsPage).toBe("function");
  });
});
