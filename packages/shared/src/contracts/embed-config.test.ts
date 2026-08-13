import { describe, expect, it } from "vitest";
import {
  embedConfigResponseSchema,
  embedDestroyMessageSchema,
  embedInboundMessageSchema,
  embedTicketRequestSchema,
  embedTicketResponseSchema,
} from "./embed-config.js";

describe("embedInboundMessageSchema", () => {
  it("accepts a ready message", () => {
    expect(embedInboundMessageSchema.safeParse({ type: "avatrain:ready" }).success).toBe(true);
  });

  it("accepts a resize message with a positive height", () => {
    expect(embedInboundMessageSchema.safeParse({ type: "avatrain:resize", height: 620 }).success).toBe(true);
  });

  it("rejects a resize message with a non-positive height", () => {
    expect(embedInboundMessageSchema.safeParse({ type: "avatrain:resize", height: 0 }).success).toBe(false);
    expect(embedInboundMessageSchema.safeParse({ type: "avatrain:resize", height: -10 }).success).toBe(false);
  });

  it("rejects an unknown message type", () => {
    expect(embedInboundMessageSchema.safeParse({ type: "something-else" }).success).toBe(false);
  });
});

describe("embedDestroyMessageSchema", () => {
  it("accepts a destroy message", () => {
    expect(embedDestroyMessageSchema.safeParse({ type: "avatrain:destroy" }).success).toBe(true);
  });
});

describe("embedConfigResponseSchema", () => {
  it("accepts a fully-populated config", () => {
    const config = {
      avatarId: "6e1b6f0a-7f0e-4c1b-9e6a-1e3a2b4c5d6e",
      avatarName: "Priya",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      skinTone: "TONE_2",
      hairStyle: "MEDIUM",
      hairColor: "AUBURN",
    };
    expect(embedConfigResponseSchema.safeParse(config).success).toBe(true);
  });

  it("allows skinTone/hairStyle/hairColor to be null (a persona created without full customization)", () => {
    const config = {
      avatarId: "6e1b6f0a-7f0e-4c1b-9e6a-1e3a2b4c5d6e",
      avatarName: "Priya",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      skinTone: null,
      hairStyle: null,
      hairColor: null,
    };
    expect(embedConfigResponseSchema.safeParse(config).success).toBe(true);
  });
});

describe("embedTicketRequestSchema / embedTicketResponseSchema", () => {
  it("requires a non-empty key", () => {
    expect(embedTicketRequestSchema.safeParse({ key: "pk_abc" }).success).toBe(true);
    expect(embedTicketRequestSchema.safeParse({ key: "" }).success).toBe(false);
  });

  it("accepts a ticket response", () => {
    expect(embedTicketResponseSchema.safeParse({ ticket: "tok_abc", expiresAt: 123456 }).success).toBe(true);
  });
});
