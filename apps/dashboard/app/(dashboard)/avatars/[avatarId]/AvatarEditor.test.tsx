import { describe, expect, it } from "vitest";
import { AvatarEditor } from "./AvatarEditor";

describe("AvatarEditor", () => {
  it("exports a component", () => {
    expect(typeof AvatarEditor).toBe("function");
  });
});
