import { describe, expect, it } from "vitest";
import OnboardingRootPage from "./page";

describe("onboarding root page", () => {
  it("exports a page component", () => {
    expect(typeof OnboardingRootPage).toBe("function");
  });
});
