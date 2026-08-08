import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt.js";

describe("buildSystemPrompt", () => {
  it("includes the avatar name and the resolved topic title", () => {
    const prompt = buildSystemPrompt({ avatarName: "Nancy", expertise: "HR_LEAVE_POLICY" });
    expect(prompt).toContain("Nancy");
    expect(prompt).toContain("HR & Leave Policy");
  });

  it("instructs a structured lesson plan: intro, segments, checks, quiz", () => {
    const prompt = buildSystemPrompt({ avatarName: "Nancy", expertise: "IT_TECHNOLOGY" });
    expect(prompt).toMatch(/introduce/i);
    expect(prompt).toMatch(/segment/i);
    expect(prompt).toMatch(/check.*understanding/i);
    expect(prompt).toMatch(/quiz/i);
  });

  it("defaults to an English response instruction when language is omitted", () => {
    const prompt = buildSystemPrompt({ avatarName: "Nancy", expertise: "HR_LEAVE_POLICY" });
    expect(prompt).toMatch(/Respond in English/);
  });

  it("instructs a Hindi response when language is Hindi", () => {
    const prompt = buildSystemPrompt({ avatarName: "Priya", expertise: "HR_LEAVE_POLICY", language: "Hindi" });
    expect(prompt).toMatch(/Respond in Hindi/);
    expect(prompt).not.toMatch(/Respond in English/);
  });

  it("instructs concise spoken-style replies", () => {
    const prompt = buildSystemPrompt({ avatarName: "Nancy", expertise: "SALES_NEGOTIATION" });
    expect(prompt).toMatch(/concise/i);
    expect(prompt).toMatch(/spoken/i);
  });

  it("produces a distinct topic title for every expertise value", () => {
    const expertiseValues = [
      "HR_LEAVE_POLICY",
      "SALES_NEGOTIATION",
      "COMPLIANCE_LEGAL",
      "PRODUCT_TRAINING",
      "CUSTOMER_SUPPORT",
      "LEADERSHIP_MANAGEMENT",
      "FINANCE_ACCOUNTING",
      "IT_TECHNOLOGY",
      "MARKETING_BRANDING",
    ] as const;
    const prompts = expertiseValues.map((expertise) => buildSystemPrompt({ avatarName: "N", expertise }));
    expect(new Set(prompts).size).toBe(expertiseValues.length);
  });
});
