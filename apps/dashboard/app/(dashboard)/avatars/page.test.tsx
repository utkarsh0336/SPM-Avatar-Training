import { describe, expect, it } from "vitest";
import AvatarsPage from "./page";

describe("avatars page", () => {
  it("exports a page component", () => {
    expect(typeof AvatarsPage).toBe("function");
  });
});
