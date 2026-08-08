import { describe, expect, it } from "vitest";
import {
  avatarStyleSchema,
  expertiseSchema,
  genderSchema,
  onboardingHandoffSchema,
  outfitSchema,
  voiceToneSchema,
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
});

describe("onboardingHandoffSchema", () => {
  it("accepts a valid handoff payload", () => {
    const result = onboardingHandoffSchema.safeParse({
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      name: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voice: "WARM",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown enum value", () => {
    const result = onboardingHandoffSchema.safeParse({
      style: "PHOTOREAL",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      name: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voice: "WARM",
    });
    expect(result.success).toBe(false);
  });

  it("does not require presentation-only fields (skinTone/hairStyle/hairColor)", () => {
    const result = onboardingHandoffSchema.safeParse({
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      name: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voice: "WARM",
    });
    expect(result.success).toBe(true);
  });

});
