import { describe, expect, it } from "vitest";
import { clientMessageSchema, serverMessageSchema } from "./ws-messages.js";

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
