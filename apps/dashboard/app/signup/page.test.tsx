import { describe, expect, it } from "vitest";
import SignupPage from "./page";

describe("signup page", () => {
  it("exports a page component", () => {
    expect(typeof SignupPage).toBe("function");
  });
});
