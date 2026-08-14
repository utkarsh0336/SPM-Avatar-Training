import { describe, expect, it } from "vitest";
import MembersPage from "./page";

describe("members page", () => {
  it("exports a page component", () => {
    expect(typeof MembersPage).toBe("function");
  });
});
