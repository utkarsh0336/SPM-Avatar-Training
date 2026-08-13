import { describe, expect, it } from "vitest";
import {
  onboardingDraftSchema,
  onboardingCompleteRequiredSchema,
  avatarNameSchema,
  SKIN_TONE_TOKENS,
  HAIR_COLOR_TOKENS,
  AVATAR_PREVIEW_URL_ALLOWED_HOSTS,
} from "./schema.js";

// The literal-value drift guard for these tokens lives in
// tutor/avatar-config.test.ts now (that's where they're actually defined —
// see this file's import comment above). This just confirms the re-export
// wiring itself still works.
describe("SKIN_TONE_TOKENS / HAIR_COLOR_TOKENS re-export", () => {
  it("re-exports non-empty token lists from tutor/avatar-config", () => {
    expect(SKIN_TONE_TOKENS.length).toBeGreaterThan(0);
    expect(HAIR_COLOR_TOKENS.length).toBeGreaterThan(0);
  });
});

describe("avatarNameSchema", () => {
  it("accepts letters, accents, numbers, spaces, and - ' .", () => {
    expect(avatarNameSchema.safeParse("Renée O'Neil-Smith 2").success).toBe(true);
  });

  it("rejects names shorter than 2 chars after trim", () => {
    expect(avatarNameSchema.safeParse("  A  ").success).toBe(false);
  });

  it("rejects emoji and other punctuation", () => {
    expect(avatarNameSchema.safeParse("Ava 🤖").success).toBe(false);
    expect(avatarNameSchema.safeParse("Ava!").success).toBe(false);
  });
});

describe("onboardingDraftSchema", () => {
  it("accepts an empty object — every field optional", () => {
    expect(onboardingDraftSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a partial patch with just one field", () => {
    expect(onboardingDraftSchema.safeParse({ gender: "FEMALE" }).success).toBe(true);
  });

  it("rejects an invalid enum value", () => {
    expect(onboardingDraftSchema.safeParse({ gender: "ROBOT" }).success).toBe(false);
  });

  it("accepts the 4 additive preview fields together", () => {
    const result = onboardingDraftSchema.safeParse({
      previewProvider: "READY_PLAYER_ME",
      externalAvatarId: "abc123",
      avatarModelUrl: `https://${AVATAR_PREVIEW_URL_ALLOWED_HOSTS[0]}/avatar.glb`,
      avatarSnapshotUrl: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a preview URL whose host isn't allowlisted", () => {
    const result = onboardingDraftSchema.safeParse({
      avatarModelUrl: "https://evil.example.com/avatar.glb",
    });
    expect(result.success).toBe(false);
  });
});

describe("onboardingCompleteRequiredSchema", () => {
  const validComplete = {
    name: "My Avatar",
    style: "REALISTIC",
    gender: "FEMALE",
    skinTone: "TONE_2",
    hairStyle: "MEDIUM",
    hairColor: "AUBURN",
    outfit: "BUSINESS_FORMAL",
    expertise: "HR_LEAVE_POLICY",
    voice: "NEUTRAL",
  };

  it("accepts a fully-populated draft with no preview fields at all", () => {
    expect(onboardingCompleteRequiredSchema.safeParse(validComplete).success).toBe(true);
  });

  it("rejects a draft missing a required field", () => {
    const missingVoice: Partial<typeof validComplete> = { ...validComplete };
    delete missingVoice.voice;
    const result = onboardingCompleteRequiredSchema.safeParse(missingVoice);
    expect(result.success).toBe(false);
  });

  it("does not require any of the 4 preview fields to be present", () => {
    // Sanity check the schema's own shape has no preview keys at all.
    expect(Object.keys(onboardingCompleteRequiredSchema.shape)).not.toContain("previewProvider");
    expect(Object.keys(onboardingCompleteRequiredSchema.shape)).not.toContain("avatarModelUrl");
  });
});
