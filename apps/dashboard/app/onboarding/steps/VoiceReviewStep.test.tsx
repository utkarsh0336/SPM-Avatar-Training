import { describe, expect, it } from "vitest";
import { VoiceReviewStep } from "./VoiceReviewStep";

describe("VoiceReviewStep", () => {
  it("exports a component", () => {
    expect(typeof VoiceReviewStep).toBe("function");
  });
});
