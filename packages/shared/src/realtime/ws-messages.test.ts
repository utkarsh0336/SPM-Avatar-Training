import { describe, expect, it } from "vitest";
import { clientMessageSchema, serverMessageSchema, sessionStartMessageSchema } from "./ws-messages.js";

describe("clientMessageSchema", () => {
  it("accepts a valid session.start message", () => {
    const result = clientMessageSchema.safeParse({
      type: "session.start",
      avatarName: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "HR & Leave Policy",
    });
    expect(result.success).toBe(true);
  });

  it("defaults session.start's language to English when omitted", () => {
    const result = sessionStartMessageSchema.safeParse({
      type: "session.start",
      avatarName: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "HR & Leave Policy",
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.language).toBe("English");
  });

  it("accepts an explicit Hindi language on session.start", () => {
    const result = sessionStartMessageSchema.safeParse({
      type: "session.start",
      avatarName: "Priya",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "HR & Leave Policy",
      language: "Hindi",
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.language).toBe("Hindi");
  });

  it("rejects session.start with an unsupported language", () => {
    const result = clientMessageSchema.safeParse({
      type: "session.start",
      avatarName: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "HR & Leave Policy",
      language: "French",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid audio.chunk message", () => {
    const result = clientMessageSchema.safeParse({
      type: "audio.chunk",
      utteranceId: "u1",
      audioBase64: "AAAA",
      mimeType: "audio/wav",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid barge_in message", () => {
    expect(clientMessageSchema.safeParse({ type: "barge_in", utteranceId: "u1" }).success).toBe(true);
  });

  it("accepts a valid session.end message", () => {
    expect(clientMessageSchema.safeParse({ type: "session.end" }).success).toBe(true);
  });

  it("accepts a valid session.rate message with an optional comment", () => {
    expect(clientMessageSchema.safeParse({ type: "session.rate", rating: 5, comment: "Great session!" }).success).toBe(
      true,
    );
  });

  it("accepts session.rate with comment omitted", () => {
    expect(clientMessageSchema.safeParse({ type: "session.rate", rating: 3 }).success).toBe(true);
  });

  it("rejects session.rate with a rating outside 1-5", () => {
    expect(clientMessageSchema.safeParse({ type: "session.rate", rating: 0 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: "session.rate", rating: 6 }).success).toBe(false);
  });

  it("rejects session.rate with a non-integer rating", () => {
    expect(clientMessageSchema.safeParse({ type: "session.rate", rating: 3.5 }).success).toBe(false);
  });

  it("rejects session.rate with a comment over 500 characters", () => {
    expect(
      clientMessageSchema.safeParse({ type: "session.rate", rating: 4, comment: "x".repeat(501) }).success,
    ).toBe(false);
  });

  it("rejects an unknown message type", () => {
    expect(clientMessageSchema.safeParse({ type: "not.a.real.type" }).success).toBe(false);
  });

  it("rejects session.start with an invalid expertise enum value", () => {
    const result = clientMessageSchema.safeParse({
      type: "session.start",
      avatarName: "Nancy",
      expertise: "NOT_A_REAL_EXPERTISE",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "topic",
    });
    expect(result.success).toBe(false);
  });

  it("rejects text.fallback with empty text", () => {
    expect(
      clientMessageSchema.safeParse({ type: "text.fallback", utteranceId: "u1", text: "" }).success,
    ).toBe(false);
  });
});

describe("serverMessageSchema", () => {
  it("accepts a valid tts.chunk message carrying the sentence's own text", () => {
    const result = serverMessageSchema.safeParse({
      type: "tts.chunk",
      utteranceId: "u1",
      sentenceIndex: 0,
      text: "Hello there.",
      audioBase64: "AAAA",
      mimeType: "audio/wav",
      isLastForUtterance: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid turn.failed message", () => {
    const result = serverMessageSchema.safeParse({
      type: "turn.failed",
      utteranceId: "u1",
      kind: "llm",
      message: "All LLM providers failed",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a latency message with optional per-hop fields omitted", () => {
    const result = serverMessageSchema.safeParse({
      type: "latency",
      utteranceId: "u1",
      totalMs: 950,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a latency message with retrievalMs set", () => {
    const result = serverMessageSchema.safeParse({
      type: "latency",
      utteranceId: "u1",
      totalMs: 950,
      retrievalMs: 42,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a latency.budget_exceeded message and rejects one missing budgetMs", () => {
    const result = serverMessageSchema.safeParse({
      type: "latency.budget_exceeded",
      utteranceId: "u1",
      budgetMs: 1400,
    });
    expect(result.success).toBe(true);

    const missingBudget = serverMessageSchema.safeParse({
      type: "latency.budget_exceeded",
      utteranceId: "u1",
    });
    expect(missingBudget.success).toBe(false);
  });

  it("accepts an avatar transcript message with source attribution", () => {
    const result = serverMessageSchema.safeParse({
      type: "transcript",
      role: "avatar",
      text: "Employees get 20 days of leave per year.",
      utteranceId: "u1",
      final: true,
      sources: [{ documentId: "8c9a6c1a-6d1a-4c2e-9c1a-6d1a4c2e9c1a", title: "Leave Policy" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a transcript message with sources omitted (ungrounded reply)", () => {
    const result = serverMessageSchema.safeParse({
      type: "transcript",
      role: "avatar",
      text: "General knowledge answer.",
      utteranceId: "u1",
      final: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an avatar transcript message with an emotion", () => {
    const result = serverMessageSchema.safeParse({
      type: "transcript",
      role: "avatar",
      text: "Great job, that's exactly right!",
      utteranceId: "u1",
      final: true,
      emotion: "happy",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a transcript message with emotion omitted (pre-emotion clients)", () => {
    const result = serverMessageSchema.safeParse({
      type: "transcript",
      role: "user",
      text: "What's the leave policy?",
      utteranceId: "u1",
      final: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown emotion value", () => {
    const result = serverMessageSchema.safeParse({
      type: "transcript",
      role: "avatar",
      text: "Great job!",
      utteranceId: "u1",
      final: true,
      emotion: "furious",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative sentenceIndex", () => {
    const result = serverMessageSchema.safeParse({
      type: "tts.chunk",
      utteranceId: "u1",
      sentenceIndex: -1,
      text: "hi",
      audioBase64: "AAAA",
      mimeType: "audio/wav",
      isLastForUtterance: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects turn.failed with an invalid kind", () => {
    const result = serverMessageSchema.safeParse({
      type: "turn.failed",
      utteranceId: "u1",
      kind: "avatar",
      message: "oops",
    });
    expect(result.success).toBe(false);
  });
});
