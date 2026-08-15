import { describe, expect, it } from "vitest";
import {
  createTrainingSessionRequestSchema,
  listTrainingSessionMessagesQuerySchema,
  trainingSessionIdRouteParamSchema,
} from "./schema.js";

const AVATAR_ID = "6e1b6f0a-7f0e-4c1b-9e6a-1e3a2b4c5d6e";
const CLIENT_REQUEST_ID = "1e3a2b4c-5d6e-4c1b-9e6a-7f0e6e1b6f0a";

describe("trainingSessionIdRouteParamSchema", () => {
  it("accepts a valid uuid", () => {
    expect(trainingSessionIdRouteParamSchema.safeParse({ trainingSessionId: AVATAR_ID }).success).toBe(true);
  });

  it("rejects a non-uuid slug (the old client-generated id shape)", () => {
    expect(trainingSessionIdRouteParamSchema.safeParse({ trainingSessionId: "session-1734000000" }).success).toBe(
      false,
    );
  });
});

describe("createTrainingSessionRequestSchema", () => {
  it("accepts a VIDEO_CHAT request with avatarId and no voiceExpertId", () => {
    const result = createTrainingSessionRequestSchema.safeParse({
      kind: "VIDEO_CHAT",
      title: "Sales Pitch Practice",
      avatarId: AVATAR_ID,
      clientRequestId: CLIENT_REQUEST_ID,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a VIDEO_CHAT request omitting avatarId (server resolves the caller's default persona)", () => {
    const result = createTrainingSessionRequestSchema.safeParse({
      kind: "VIDEO_CHAT",
      title: "Sales Pitch Practice",
      clientRequestId: CLIENT_REQUEST_ID,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a VIDEO_CHAT request that also sets voiceExpertId", () => {
    const result = createTrainingSessionRequestSchema.safeParse({
      kind: "VIDEO_CHAT",
      title: "Sales Pitch Practice",
      avatarId: AVATAR_ID,
      voiceExpertId: "priya",
      clientRequestId: CLIENT_REQUEST_ID,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a VOICE_ONLY request with voiceExpertId and no avatarId", () => {
    const result = createTrainingSessionRequestSchema.safeParse({
      kind: "VOICE_ONLY",
      title: "Maternity Leave Policy",
      voiceExpertId: "priya",
      clientRequestId: CLIENT_REQUEST_ID,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a VOICE_ONLY request missing voiceExpertId", () => {
    const result = createTrainingSessionRequestSchema.safeParse({
      kind: "VOICE_ONLY",
      title: "Maternity Leave Policy",
      clientRequestId: CLIENT_REQUEST_ID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a VOICE_ONLY request that also sets avatarId", () => {
    const result = createTrainingSessionRequestSchema.safeParse({
      kind: "VOICE_ONLY",
      title: "Maternity Leave Policy",
      avatarId: AVATAR_ID,
      voiceExpertId: "priya",
      clientRequestId: CLIENT_REQUEST_ID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty title", () => {
    const result = createTrainingSessionRequestSchema.safeParse({
      kind: "VIDEO_CHAT",
      title: "",
      avatarId: AVATAR_ID,
      clientRequestId: CLIENT_REQUEST_ID,
    });
    expect(result.success).toBe(false);
  });
});

describe("listTrainingSessionMessagesQuerySchema", () => {
  it("accepts an empty query", () => {
    expect(listTrainingSessionMessagesQuerySchema.safeParse({}).success).toBe(true);
  });

  it("coerces string after/limit query params to numbers", () => {
    const result = listTrainingSessionMessagesQuerySchema.safeParse({ after: "10", limit: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.after).toBe(10);
      expect(result.data.limit).toBe(50);
    }
  });

  it("rejects a limit above 200", () => {
    expect(listTrainingSessionMessagesQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
  });
});
