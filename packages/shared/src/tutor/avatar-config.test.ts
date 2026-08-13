import { describe, expect, it } from "vitest";
import {
  avatarStyleSchema,
  expertiseSchema,
  genderSchema,
  hairStyleSchema,
  skinToneSchema,
  hairColorSchema,
  SKIN_TONE_TOKENS,
  HAIR_COLOR_TOKENS,
  SKIN_TONE_HEX,
  HAIR_COLOR_HEX,
  onboardingHandoffSchema,
  outfitSchema,
  voiceToneSchema,
  ageGroupSchema,
  avatarRegionSchema,
  avatarLanguageSchema,
} from "./avatar-config.js";

// Hardcoded snapshot of apps/dashboard/app/onboarding/types.ts's literal
// unions as of when this file was written. This is a drift GUARD, not a
// live cross-package import (packages/shared must not depend on an app) —
// if the wizard's types.ts changes without this file being updated to
// match, this test will NOT catch it automatically. Update both together.
const WIZARD_AVATAR_STYLES = ["REALISTIC", "ANIMATED", "STYLIZED_3D"];
const WIZARD_GENDERS = ["FEMALE", "MALE", "NEUTRAL"];
const WIZARD_OUTFITS = [
  "BUSINESS_FORMAL",
  "BUSINESS_CASUAL",
  "SMART_PROFESSIONAL",
  "TECH_CREATIVE",
  "ACADEMIC_EDUCATOR",
];
const WIZARD_EXPERTISE = [
  "HR_LEAVE_POLICY",
  "SALES_NEGOTIATION",
  "COMPLIANCE_LEGAL",
  "PRODUCT_TRAINING",
  "CUSTOMER_SUPPORT",
  "LEADERSHIP_MANAGEMENT",
  "FINANCE_ACCOUNTING",
  "IT_TECHNOLOGY",
  "MARKETING_BRANDING",
];
const WIZARD_VOICE_TONES = ["DEEP", "NEUTRAL", "WARM"];
const WIZARD_HAIR_STYLES = ["SHORT", "MEDIUM", "LONG", "CURLY", "WAVY", "BALD"];
const WIZARD_SKIN_TONES = ["TONE_1", "TONE_2", "TONE_3", "TONE_4", "TONE_5", "TONE_6"];
const WIZARD_HAIR_COLORS = ["BLACK", "AUBURN", "COPPER", "BLONDE", "PLATINUM", "RED", "PURPLE", "BLUE"];
const WIZARD_AGE_GROUPS = ["YOUNG_ADULT", "MIDDLE_AGED", "SENIOR"];
const WIZARD_AVATAR_REGIONS = ["GLOBAL", "INDIA", "NORTH_AMERICA", "EUROPE", "MIDDLE_EAST", "APAC"];
const WIZARD_AVATAR_LANGUAGES = ["ENGLISH", "HINDI"];

describe("avatar-config drift guard", () => {
  it("avatarStyleSchema matches the wizard's AvatarStyle union", () => {
    expect(avatarStyleSchema.options).toEqual(WIZARD_AVATAR_STYLES);
  });

  it("genderSchema matches the wizard's Gender union", () => {
    expect(genderSchema.options).toEqual(WIZARD_GENDERS);
  });

  it("outfitSchema matches the wizard's Outfit union", () => {
    expect(outfitSchema.options).toEqual(WIZARD_OUTFITS);
  });

  it("expertiseSchema matches the wizard's Expertise union", () => {
    expect(expertiseSchema.options).toEqual(WIZARD_EXPERTISE);
  });

  it("voiceToneSchema matches the wizard's VoiceTone union", () => {
    expect(voiceToneSchema.options).toEqual(WIZARD_VOICE_TONES);
  });

  it("hairStyleSchema matches the wizard's HairStyle union", () => {
    expect(hairStyleSchema.options).toEqual(WIZARD_HAIR_STYLES);
  });

  it("SKIN_TONE_TOKENS matches the wizard's SKIN_TONE_OPTIONS", () => {
    expect(SKIN_TONE_TOKENS).toEqual(WIZARD_SKIN_TONES);
  });

  it("HAIR_COLOR_TOKENS matches the wizard's HAIR_COLOR_OPTIONS", () => {
    expect(HAIR_COLOR_TOKENS).toEqual(WIZARD_HAIR_COLORS);
  });

  it("ageGroupSchema matches the wizard's AgeGroup union", () => {
    expect(ageGroupSchema.options).toEqual(WIZARD_AGE_GROUPS);
  });

  it("avatarRegionSchema matches the wizard's AvatarRegion union", () => {
    expect(avatarRegionSchema.options).toEqual(WIZARD_AVATAR_REGIONS);
  });

  it("avatarLanguageSchema matches the wizard's AvatarLanguage union", () => {
    expect(avatarLanguageSchema.options).toEqual(WIZARD_AVATAR_LANGUAGES);
  });
});

describe("SKIN_TONE_HEX / HAIR_COLOR_HEX", () => {
  it("has a hex entry for every skin tone token", () => {
    for (const token of SKIN_TONE_TOKENS) {
      expect(SKIN_TONE_HEX[token]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("has a hex entry for every hair color token", () => {
    for (const token of HAIR_COLOR_TOKENS) {
      expect(HAIR_COLOR_HEX[token]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("onboardingHandoffSchema", () => {
  const validPayload = {
    style: "REALISTIC",
    gender: "FEMALE",
    skinTone: "TONE_2",
    hairStyle: "MEDIUM",
    hairColor: "AUBURN",
    outfit: "BUSINESS_FORMAL",
    name: "Nancy",
    expertise: "HR_LEAVE_POLICY",
    voice: "WARM",
  };

  it("accepts a valid handoff payload", () => {
    const result = onboardingHandoffSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown enum value", () => {
    const result = onboardingHandoffSchema.safeParse({ ...validPayload, style: "PHOTOREAL" });
    expect(result.success).toBe(false);
  });

  it("requires skinTone, hairStyle, and hairColor — the VRM renderer needs them", () => {
    const { skinTone: _skinTone, ...withoutSkinTone } = validPayload;
    expect(onboardingHandoffSchema.safeParse(withoutSkinTone).success).toBe(false);

    const { hairStyle: _hairStyle, ...withoutHairStyle } = validPayload;
    expect(onboardingHandoffSchema.safeParse(withoutHairStyle).success).toBe(false);

    const { hairColor: _hairColor, ...withoutHairColor } = validPayload;
    expect(onboardingHandoffSchema.safeParse(withoutHairColor).success).toBe(false);
  });

  it("rejects an unknown skinTone/hairColor token", () => {
    expect(onboardingHandoffSchema.safeParse({ ...validPayload, skinTone: "TONE_99" }).success).toBe(false);
    expect(onboardingHandoffSchema.safeParse({ ...validPayload, hairColor: "TEAL" }).success).toBe(false);
  });
});

describe("skinToneSchema / hairColorSchema", () => {
  it("accept every known token", () => {
    for (const token of SKIN_TONE_TOKENS) expect(skinToneSchema.safeParse(token).success).toBe(true);
    for (const token of HAIR_COLOR_TOKENS) expect(hairColorSchema.safeParse(token).success).toBe(true);
  });
});
