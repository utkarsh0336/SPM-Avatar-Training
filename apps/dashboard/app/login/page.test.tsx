import { describe, expect, it } from "vitest";
import LoginPage from "./page";

describe("login page", () => {
  it("exports a page component", () => {
    expect(typeof LoginPage).toBe("function");
  });
});
