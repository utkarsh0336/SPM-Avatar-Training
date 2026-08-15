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
/** SOW §3.1 "various age groups" — metadata only, see prisma/schema.prisma's AgeGroup doc comment. */
export const ageGroupSchema = z.enum(["YOUNG_ADULT", "MIDDLE_AGED", "SENIOR"]);
/** SOW §3.1 "regional ... avatars" — metadata only, see prisma/schema.prisma's AvatarRegion doc comment. */
export const avatarRegionSchema = z.enum(["GLOBAL", "INDIA", "NORTH_AMERICA", "EUROPE", "MIDDLE_EAST", "APAC"]);
/**
 * SOW §3.1 "... language-specific avatars" — an Avatar's own metadata field,
 * deliberately distinct from `languageSchema` below (English/Hindi/Spanish, used
 * in the ephemeral WS session.start message). SCREAMING_CASE matches
 * every other avatar enum in this file, so avatar-service.ts's/onboarding-
 * service.ts's generic patch passthrough needs no value-casing mapping.
 * Trainer-set, audience-wide; resolved server-side into the session's Language
 * via resolveSessionLanguage() below — see .claude/specs/multi-language-support.md.
 */
export const avatarLanguageSchema = z.enum(["ENGLISH", "HINDI", "SPANISH"]);
/**
 * Unlike ageGroup/region above (metadata only), this one is actually consumed —
 * see system-prompt.ts's buildSystemPrompt and READING_LEVEL_INSTRUCTION. Trainer-set,
 * audience-wide; not a per-learner preference — see
 * .claude/specs/adaptive-learning-personalization.md's Scope decisions.
 * (avatarLanguageSchema above is also consumed, not metadata-only either — see its own doc comment.)
 */
export const readingLevelSchema = z.enum(["SIMPLE", "STANDARD", "ADVANCED"]);
/**
 * The three languages actually wired end-to-end (LLM reply language, TTS
 * voice, STT hint) — see providers/tts-voice-map.ts's resolveHindiVoice doc
 * comment for why Hindi is Azure/msedge-tts-only (echogarden's installed
 * Piper voice catalog has no Hindi entries, verified live), and
 * resolveSpanishPrimaryVoice/resolveSpanishVoice for Spanish's two-candidate
 * failover (echogarden DOES have usable Spanish voices, verified live).
 */
export const languageSchema = z.enum(["English", "Hindi", "Spanish"]);

export const hairStyleSchema = z.enum(["SHORT", "MEDIUM", "LONG", "CURLY", "WAVY", "BALD"]);

// Application-layer allowlists — `avatars.skin_tone`/`hair_color` are plain
// Postgres TEXT columns, not enums, so the palette can change without a
// migration. See .claude/specs/onboarding.md's Database Changes. Values must
// stay in sync with apps/dashboard/app/onboarding/types.ts's
// SKIN_TONE_OPTIONS/HAIR_COLOR_OPTIONS — avatar-config.test.ts drift-guards
// this. Owned here (rather than onboarding/schema.ts, which re-exports them)
// so vrm-material-tint.ts (packages/avatar-core) can resolve a token straight
// to a paintable hex value without onboarding/schema.ts importing back from
// this file — see SKIN_TONE_HEX/HAIR_COLOR_HEX below.
export const SKIN_TONE_TOKENS = ["TONE_1", "TONE_2", "TONE_3", "TONE_4", "TONE_5", "TONE_6"] as const;
export const skinToneSchema = z.enum(SKIN_TONE_TOKENS);

export const HAIR_COLOR_TOKENS = [
  "BLACK",
  "AUBURN",
  "COPPER",
  "BLONDE",
  "PLATINUM",
  "RED",
  "PURPLE",
  "BLUE",
] as const;
export const hairColorSchema = z.enum(HAIR_COLOR_TOKENS);

// Literal hex values for each token — single source of truth for both the
// wizard's swatch pickers (apps/dashboard/app/onboarding/types.ts re-exports
// these instead of hardcoding its own copy) and packages/avatar-core's VRM
// material tinting (vrm-material-tint.ts). Values copied verbatim from the
// wizard's original SKIN_TONE_SWATCHES/HAIR_COLOR_SWATCHES.
export const SKIN_TONE_HEX: Record<(typeof SKIN_TONE_TOKENS)[number], string> = {
  TONE_1: "#F7DFC4",
  TONE_2: "#EFC9A2",
  TONE_3: "#DCA477",
  TONE_4: "#BE8148",
  TONE_5: "#9C6432",
  TONE_6: "#7A4A24",
};

export const HAIR_COLOR_HEX: Record<(typeof HAIR_COLOR_TOKENS)[number], string> = {
  BLACK: "#2B2724",
  AUBURN: "#7A4020",
  COPPER: "#A5622F",
  BLONDE: "#D4A83C",
  PLATINUM: "#EDE0C8",
  RED: "#C43B2C",
  PURPLE: "#7B3FA0",
  BLUE: "#3B7FC4",
};

export type AvatarStyle = z.infer<typeof avatarStyleSchema>;
export type Gender = z.infer<typeof genderSchema>;
export type Outfit = z.infer<typeof outfitSchema>;
export type Expertise = z.infer<typeof expertiseSchema>;
export type VoiceTone = z.infer<typeof voiceToneSchema>;
export type AgeGroup = z.infer<typeof ageGroupSchema>;
export type AvatarRegion = z.infer<typeof avatarRegionSchema>;
export type AvatarLanguage = z.infer<typeof avatarLanguageSchema>;
export type ReadingLevel = z.infer<typeof readingLevelSchema>;
export type Language = z.infer<typeof languageSchema>;
export type HairStyleValue = z.infer<typeof hairStyleSchema>;

const AVATAR_LANGUAGE_TO_LANGUAGE: Record<AvatarLanguage, Language> = {
  ENGLISH: "English",
  HINDI: "Hindi",
  SPANISH: "Spanish",
};

/** Maps the persisted, trainer-set Avatar.preferredLanguage to the Language value the conversation pipeline (LLM/STT/TTS) actually consumes. */
export function resolveSessionLanguage(avatarLanguage: AvatarLanguage): Language {
  return AVATAR_LANGUAGE_TO_LANGUAGE[avatarLanguage];
}

/**
 * The subset of OnboardingState the session actually needs. skinTone,
 * hairStyle, and hairColor now travel through this handoff too — the VRM
 * avatar provider (packages/avatar-core's createVrmAvatarProvider) applies
 * them as live material tints on the rendered model, so they're no longer
 * presentation-only. simliFaceId is still deliberately excluded: it doesn't
 * need to travel through this client-side handoff at all —
 * POST /v1/conversations/simli-session resolves it server-side from the
 * caller's own authenticated Avatar record, the same way for both the
 * builder preview and a live training session, rather than trusting a
 * client-supplied value. See .claude/specs/avatar-builder-customization.md.
 */
export const onboardingHandoffSchema = z.object({
  style: avatarStyleSchema,
  gender: genderSchema,
  skinTone: skinToneSchema,
  hairStyle: hairStyleSchema,
  hairColor: hairColorSchema,
  outfit: outfitSchema,
  name: z.string(),
  expertise: expertiseSchema,
  voice: voiceToneSchema,
});
export type OnboardingHandoff = z.infer<typeof onboardingHandoffSchema>;
