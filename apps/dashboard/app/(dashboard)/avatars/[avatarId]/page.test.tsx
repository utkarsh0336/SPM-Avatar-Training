import { describe, expect, it } from "vitest";
import AvatarEditorPage from "./page";

describe("avatar editor page", () => {
  it("exports a page component", () => {
    expect(typeof AvatarEditorPage).toBe("function");
  });
});
