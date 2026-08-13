import { describe, expect, it } from "vitest";
import { classifyEmotion } from "./emotion.js";

describe("classifyEmotion", () => {
  it("returns neutral for plain informational text", () => {
    expect(classifyEmotion("The leave policy allows 18 days of paid time off per year.")).toBe("neutral");
  });

  it("returns happy for positive/congratulatory replies", () => {
    expect(classifyEmotion("Great job, that's exactly right!")).toBe("happy");
    expect(classifyEmotion("Well done — you got it.")).toBe("happy");
  });

  it("returns sad for apologetic/corrective replies", () => {
    expect(classifyEmotion("Sorry, that's not quite right — let's try again.")).toBe("sad");
    expect(classifyEmotion("Unfortunately that was incorrect.")).toBe("sad");
  });

  it("returns surprised for replies flagging something unexpected", () => {
    expect(classifyEmotion("Interesting — actually, most teams didn't expect that outcome.")).toBe("surprised");
  });

  it("multiple question marks alone nudge toward surprised", () => {
    expect(classifyEmotion("Wait, really?? Are you sure??")).toBe("surprised");
  });

  it("is case-insensitive", () => {
    expect(classifyEmotion("GREAT JOB, that's EXACTLY RIGHT!")).toBe("happy");
  });

  it("never returns angry or relaxed — not in the schema at all", () => {
    for (const text of ["I am furious!!!", "Take it easy, relax."]) {
      expect(["happy", "sad", "surprised", "neutral"]).toContain(classifyEmotion(text));
    }
  });
});
