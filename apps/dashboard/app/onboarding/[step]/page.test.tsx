import { describe, expect, it } from "vitest";
import OnboardingStepPage from "./page";

describe("onboarding step page", () => {
  it("exports a page component", () => {
    expect(typeof OnboardingStepPage).toBe("function");
  });
});
