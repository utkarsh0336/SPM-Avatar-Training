import { z } from "zod";

/**
 * Duplicated literal unions rather than importing apps/dashboard's
 * onboarding/types.ts — packages/shared must not depend on an app. This is
 * the authoritative Zod version used for the localStorage handoff payload
 * and its server-side validation. avatar-config.test.ts snapshot-checks
 * these literal sets against a hardcoded copy of the wizard's values as a
 * drift guard; it cannot detect the wizard changing on its own without this
 * file also being touched, since it isn't a live cross-package import.
 */
export const avatarStyleSchema = z.enum(["REALISTIC", "ANIMATED", "STYLIZED_3D"]);
export const genderSchema = z.enum(["FEMALE", "MALE", "NEUTRAL"]);
export const outfitSchema = z.enum([
  "BUSINESS_FORMAL",
  "BUSINESS_CASUAL",
  "SMART_PROFESSIONAL",
  "TECH_CREATIVE",
  "ACADEMIC_EDUCATOR",
]);
export const expertiseSchema = z.enum([
  "HR_LEAVE_POLICY",
  "SALES_NEGOTIATION",
  "COMPLIANCE_LEGAL",
  "PRODUCT_TRAINING",
  "CUSTOMER_SUPPORT",
  "LEADERSHIP_MANAGEMENT",
  "FINANCE_ACCOUNTING",
  "IT_TECHNOLOGY",
  "MARKETING_BRANDING",
]);
export const voiceToneSchema = z.enum(["DEEP", "NEUTRAL", "WARM"]);

export type AvatarStyle = z.infer<typeof avatarStyleSchema>;
export type Gender = z.infer<typeof genderSchema>;
export type Outfit = z.infer<typeof outfitSchema>;
export type Expertise = z.infer<typeof expertiseSchema>;
export type VoiceTone = z.infer<typeof voiceToneSchema>;

/**
 * The subset of OnboardingState the session actually needs. skinTone,
 * hairStyle, and hairColor are deliberately excluded — the brief (§6) makes
 * them presentation-only (drive the wizard's preview card, never the
 * renderer or system prompt), and the Mock avatar renders a fixed idle clip
 * with no per-attribute customization. simliFaceId is deliberately excluded
 * too, but for a different reason: it doesn't need to travel through this
 * client-side handoff at all — POST /v1/conversations/simli-session
 * resolves it server-side from the caller's own authenticated Avatar
 * record, the same way for both the builder preview and a live training
 * session, rather than trusting a client-supplied value. See
 * .claude/specs/avatar-builder-customization.md.
 */
export const onboardingHandoffSchema = z.object({
  style: avatarStyleSchema,
  gender: genderSchema,
  outfit: outfitSchema,
  name: z.string(),
  expertise: expertiseSchema,
  voice: voiceToneSchema,
});
export type OnboardingHandoff = z.infer<typeof onboardingHandoffSchema>;
