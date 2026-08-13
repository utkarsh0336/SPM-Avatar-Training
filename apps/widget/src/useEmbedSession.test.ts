import { describe, expect, it } from "vitest";
import { useEmbedSession } from "./useEmbedSession.js";

describe("useEmbedSession", () => {
  it("exports a hook", () => {
    expect(typeof useEmbedSession).toBe("function");
  });
});
