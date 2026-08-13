import { describe, expect, it } from "vitest";
import { appendCurriculumContext, appendKnowledgeContext, buildSystemPrompt } from "./system-prompt.js";

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

  it("defaults to the STANDARD reading-level instruction when readingLevel is omitted", () => {
    const prompt = buildSystemPrompt({ avatarName: "Nancy", expertise: "HR_LEAVE_POLICY" });
    expect(prompt).toMatch(/clear, professional language/i);
  });

  it("uses plain-language instructions for readingLevel SIMPLE", () => {
    const prompt = buildSystemPrompt({ avatarName: "Nancy", expertise: "HR_LEAVE_POLICY", readingLevel: "SIMPLE" });
    expect(prompt).toMatch(/plain language/i);
    expect(prompt).toMatch(/avoid jargon/i);
  });

  it("uses domain-terminology instructions for readingLevel ADVANCED", () => {
    const prompt = buildSystemPrompt({ avatarName: "Nancy", expertise: "IT_TECHNOLOGY", readingLevel: "ADVANCED" });
    expect(prompt).toMatch(/domain terminology/i);
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

describe("appendCurriculumContext", () => {
  it("returns the base prompt unchanged when there are no objectives", () => {
    const base = "You are Nancy, an AI avatar trainer.";
    expect(appendCurriculumContext(base, [])).toBe(base);
  });

  it("lists every objective's id, title, teaching content, and check question", () => {
    const base = "You are Nancy, an AI avatar trainer.";
    const result = appendCurriculumContext(base, [
      { id: "obj-1", title: "Leave policy basics", teachingContent: "Employees get 20 days.", checkQuestion: "How many days?" },
      { id: "obj-2", title: "Approval process", teachingContent: "Manager sign-off required.", checkQuestion: "Who approves?" },
    ]);

    expect(result).toContain(base);
    expect(result).toContain("obj-1");
    expect(result).toContain("Leave policy basics");
    expect(result).toContain("Employees get 20 days.");
    expect(result).toContain("How many days?");
    expect(result).toContain("obj-2");
    expect(result).toContain("Approval process");
  });

  it("instructs the model to use start_checkpoint, grade_answer, record_progress, and end_module", () => {
    const result = appendCurriculumContext("base", [
      { id: "obj-1", title: "T", teachingContent: "C", checkQuestion: "Q" },
    ]);
    expect(result).toMatch(/start_checkpoint/);
    expect(result).toMatch(/grade_answer/);
    expect(result).toMatch(/record_progress/);
    expect(result).toMatch(/end_module/);
  });

  it("treats an objective with no status as not yet attempted", () => {
    const result = appendCurriculumContext("base", [
      { id: "obj-1", title: "T", teachingContent: "C", checkQuestion: "Q" },
    ]);
    expect(result).toMatch(/not yet attempted/i);
  });

  it("annotates a MASTERED objective and instructs the model not to re-teach it", () => {
    const result = appendCurriculumContext("base", [
      { id: "obj-1", title: "Leave basics", teachingContent: "C", checkQuestion: "Q", status: "MASTERED" },
    ]);
    expect(result).toMatch(/MASTERED/);
    expect(result).toMatch(/do not re-teach/i);
    expect(result).toMatch(/skip objectives already mastered/i);
  });

  it("annotates a NEEDS_REVIEW objective with its last feedback", () => {
    const result = appendCurriculumContext("base", [
      {
        id: "obj-2",
        title: "Approval process",
        teachingContent: "C",
        checkQuestion: "Q",
        status: "NEEDS_REVIEW",
        lastFeedback: "Missed the manager sign-off step.",
      },
    ]);
    expect(result).toMatch(/NEEDS_REVIEW/);
    expect(result).toMatch(/Missed the manager sign-off step\./);
    expect(result).toMatch(/explain it a different way/i);
  });

  it("does not change objective order based on status", () => {
    const objectives = [
      { id: "obj-1", title: "First", teachingContent: "C", checkQuestion: "Q", status: "MASTERED" as const },
      { id: "obj-2", title: "Second", teachingContent: "C", checkQuestion: "Q", status: "NOT_STARTED" as const },
    ];
    const result = appendCurriculumContext("base", objectives);
    expect(result.indexOf("First")).toBeLessThan(result.indexOf("Second"));
  });
});
