import { describe, expect, it } from "vitest";
import {
  avatarIdParamSchema,
  avatarRecordSchema,
  createAvatarRequestSchema,
  listMyAvatarsResponseSchema,
} from "./schema.js";

describe("avatarIdParamSchema", () => {
  it("accepts a valid uuid", () => {
    expect(avatarIdParamSchema.safeParse({ avatarId: "6e1b6f0a-7f0e-4c1b-9e6a-1e3a2b4c5d6e" }).success).toBe(true);
  });

  it("rejects a non-uuid", () => {
    expect(avatarIdParamSchema.safeParse({ avatarId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("avatarRecordSchema", () => {
  const record = {
    id: "6e1b6f0a-7f0e-4c1b-9e6a-1e3a2b4c5d6e",
    name: "My Avatar",
    style: "REALISTIC",
    gender: "FEMALE",
    skinTone: "TONE_2",
    hairStyle: "MEDIUM",
    hairColor: "AUBURN",
    outfit: "BUSINESS_FORMAL",
    expertise: "HR_LEAVE_POLICY",
    voice: "NEUTRAL",
    ageGroup: "MIDDLE_AGED",
    region: "GLOBAL",
    preferredLanguage: "ENGLISH",
    status: "ACTIVE",
    simliFaceId: null,
  };

  it("accepts a fully-populated ACTIVE avatar", () => {
    expect(avatarRecordSchema.safeParse(record).success).toBe(true);
  });

  it("accepts a fresh draft with every customization field still null", () => {
    const draft = {
      ...record,
      name: null,
      style: null,
      gender: null,
      skinTone: null,
      hairStyle: null,
      hairColor: null,
      outfit: null,
      expertise: null,
      voice: null,
      ageGroup: null,
      region: null,
      preferredLanguage: null,
      status: "DRAFT",
    };
    expect(avatarRecordSchema.safeParse(draft).success).toBe(true);
  });

  it("accepts an ARCHIVED (soft-deleted) avatar", () => {
    expect(avatarRecordSchema.safeParse({ ...record, status: "ARCHIVED" }).success).toBe(true);
  });

  it("rejects an invalid status", () => {
    expect(avatarRecordSchema.safeParse({ ...record, status: "DELETED" }).success).toBe(false);
  });
});

describe("listMyAvatarsResponseSchema", () => {
  it("accepts an empty list", () => {
    expect(listMyAvatarsResponseSchema.safeParse({ avatars: [] }).success).toBe(true);
  });
});

describe("createAvatarRequestSchema", () => {
  it("accepts an empty body", () => {
    expect(createAvatarRequestSchema.safeParse({}).success).toBe(true);
  });

  it("accepts an optional name", () => {
    expect(createAvatarRequestSchema.safeParse({ name: "Sales Coach" }).success).toBe(true);
  });

  it("rejects an empty-string name", () => {
    expect(createAvatarRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
