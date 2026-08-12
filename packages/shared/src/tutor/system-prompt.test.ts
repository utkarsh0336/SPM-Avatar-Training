import { describe, expect, it } from "vitest";
import { appendKnowledgeContext, buildSystemPrompt } from "./system-prompt.js";

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

describe("appendKnowledgeContext", () => {
  it("returns the base prompt unchanged when there are no chunks", () => {
    const base = "You are Nancy, an AI avatar trainer.";
    expect(appendKnowledgeContext(base, [])).toBe(base);
  });

  it("appends every chunk's content under its own source label", () => {
    const base = "You are Nancy, an AI avatar trainer.";
    const result = appendKnowledgeContext(base, [
      { documentTitle: "Leave Policy", content: "Employees get 20 days of leave." },
      { documentTitle: "Travel Policy", content: "Business travel requires manager approval." },
    ]);

    expect(result).toContain(base);
    expect(result).toContain("[Source: Leave Policy]");
    expect(result).toContain("Employees get 20 days of leave.");
    expect(result).toContain("[Source: Travel Policy]");
    expect(result).toContain("Business travel requires manager approval.");
  });

  it("instructs the model to fall back to general knowledge, clearly flagged, when context doesn't cover the question", () => {
    const result = appendKnowledgeContext("base", [{ documentTitle: "Doc", content: "content" }]);
    expect(result).toMatch(/general knowledge/i);
  });
});
