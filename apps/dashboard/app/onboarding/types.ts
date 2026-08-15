import { SKIN_TONE_HEX, HAIR_COLOR_HEX } from "@avatrain/shared/tutor";

export const TOTAL_STEPS = 7;

export type AvatarStyle = "REALISTIC" | "ANIMATED" | "STYLIZED_3D";

export const AVATAR_STYLE_LABELS: Record<AvatarStyle, string> = {
  REALISTIC: "Realistic",
  ANIMATED: "Animated",
  STYLIZED_3D: "3D Stylized",
};
export type Gender = "FEMALE" | "MALE" | "NEUTRAL";
export type HairStyle = "SHORT" | "MEDIUM" | "LONG" | "CURLY" | "WAVY" | "BALD";
export type Outfit =
  | "BUSINESS_FORMAL"
  | "BUSINESS_CASUAL"
  | "SMART_PROFESSIONAL"
  | "TECH_CREATIVE"
  | "ACADEMIC_EDUCATOR";
export type Expertise =
  | "HR_LEAVE_POLICY"
  | "SALES_NEGOTIATION"
  | "COMPLIANCE_LEGAL"
  | "PRODUCT_TRAINING"
  | "CUSTOMER_SUPPORT"
  | "LEADERSHIP_MANAGEMENT"
  | "FINANCE_ACCOUNTING"
  | "IT_TECHNOLOGY"
  | "MARKETING_BRANDING";
export type VoiceTone = "DEEP" | "NEUTRAL" | "WARM";
export type AgeGroup = "YOUNG_ADULT" | "MIDDLE_AGED" | "SENIOR";
export type AvatarRegion = "GLOBAL" | "INDIA" | "NORTH_AMERICA" | "EUROPE" | "MIDDLE_EAST" | "APAC";
// Unlike AgeGroup/AvatarRegion above (metadata only), this one is actually consumed — resolved
// server-side into the session's Language, see prisma/schema.prisma's AvatarLanguage doc comment.
export type AvatarLanguage = "ENGLISH" | "HINDI" | "SPANISH";
// Also actually consumed, like AvatarLanguage above (not metadata-only) — see
// prisma/schema.prisma's ReadingLevel doc comment.
export type ReadingLevel = "SIMPLE" | "STANDARD" | "ADVANCED";

// Additive — see .claude/specs/avatar-builder-customization.md. NONE is the
// only value the default wizard flow ever writes; READY_PLAYER_ME is only
// set by the flag-gated "Generate 3D Avatar" step.
export type AvatarPreviewProvider = "NONE" | "READY_PLAYER_ME";

export interface OnboardingState {
  style: AvatarStyle | null;
  gender: Gender;
  skinTone: string;
  hairStyle: HairStyle;
  hairColor: string;
  outfit: Outfit;
  name: string;
  expertise: Expertise;
  voice: VoiceTone;
  ageGroup: AgeGroup;
  region: AvatarRegion;
  preferredLanguage: AvatarLanguage;
  readingLevel: ReadingLevel;
  previewProvider: AvatarPreviewProvider;
  externalAvatarId: string | null;
  avatarModelUrl: string | null;
  avatarSnapshotUrl: string | null;
  /** Read-only, server-pinned — see prisma/schema.prisma's Avatar.simliFaceId doc comment. */
  simliFaceId: string | null;
}

// Every field except `style` ships with a sensible default so the live
// preview reads as a finished avatar from step 1 onward — the wizard lets
// the trainer override each default rather than starting from a blank slate.
export const INITIAL_ONBOARDING_STATE: OnboardingState = {
  style: null,
  gender: "FEMALE",
  skinTone: "TONE_2",
  hairStyle: "MEDIUM",
  hairColor: "AUBURN",
  outfit: "BUSINESS_FORMAL",
  name: "",
  expertise: "HR_LEAVE_POLICY",
  voice: "NEUTRAL",
  ageGroup: "MIDDLE_AGED",
  region: "GLOBAL",
  preferredLanguage: "ENGLISH",
  readingLevel: "STANDARD",
  previewProvider: "NONE",
  externalAvatarId: null,
  avatarModelUrl: null,
  avatarSnapshotUrl: null,
  simliFaceId: null,
};

// Abbreviated label used in the compact live-preview stat chip.
export const OUTFIT_LABELS: Record<Outfit, string> = {
  BUSINESS_FORMAL: "Business",
  BUSINESS_CASUAL: "Business Casual",
  SMART_PROFESSIONAL: "Smart Professional",
  TECH_CREATIVE: "Tech & Creative",
  ACADEMIC_EDUCATOR: "Academic / Educator",
};

// Full title used in the Step 4 outfit picker.
export const OUTFIT_TITLES: Record<Outfit, string> = {
  BUSINESS_FORMAL: "Business Formal",
  BUSINESS_CASUAL: "Business Casual",
  SMART_PROFESSIONAL: "Smart Professional",
  TECH_CREATIVE: "Tech & Creative",
  ACADEMIC_EDUCATOR: "Academic / Educator",
};

export const OUTFIT_SUBTITLES: Record<Outfit, string> = {
  BUSINESS_FORMAL: "Suit & tie / formal dress",
  BUSINESS_CASUAL: "Smart casual, no tie",
  SMART_PROFESSIONAL: "Blazer & clean trousers",
  TECH_CREATIVE: "Casual, modern look",
  ACADEMIC_EDUCATOR: "Professional educator look",
};

export const OUTFIT_GRADIENTS: Record<Outfit, string> = {
  BUSINESS_FORMAL: "linear-gradient(160deg, #4a5568, #1c2333)",
  BUSINESS_CASUAL: "linear-gradient(160deg, #556052, #1c2333)",
  SMART_PROFESSIONAL: "linear-gradient(160deg, #5a5f73, #1c2333)",
  TECH_CREATIVE: "linear-gradient(160deg, #33384a, #14171f)",
  ACADEMIC_EDUCATOR: "linear-gradient(160deg, #6b6148, #1c2333)",
};

export const EXPERTISE_LABELS: Record<Expertise, string> = {
  HR_LEAVE_POLICY: "HR & Leave Policy",
  SALES_NEGOTIATION: "Sales & Negotiation",
  COMPLIANCE_LEGAL: "Compliance & Legal",
  PRODUCT_TRAINING: "Product Training",
  CUSTOMER_SUPPORT: "Customer Support",
  LEADERSHIP_MANAGEMENT: "Leadership & Management",
  FINANCE_ACCOUNTING: "Finance & Accounting",
  IT_TECHNOLOGY: "IT & Technology",
  MARKETING_BRANDING: "Marketing & Branding",
};

export const GENDER_LABELS: Record<Gender, string> = {
  FEMALE: "Female",
  MALE: "Male",
  NEUTRAL: "Neutral",
};

// Gradient fallback shown for the split second before an <img> using
// GENDER_PHOTOS below has painted (and if that file 404s) — not the
// "avatar preview" content itself anymore.
export const GENDER_GRADIENTS: Record<Gender, string> = {
  FEMALE: "linear-gradient(160deg, #c9793f 0%, #3a3350 55%, #1c2333 100%)",
  MALE: "linear-gradient(160deg, #4a5b73 0%, #2b3245 55%, #1c2333 100%)",
  NEUTRAL: "linear-gradient(160deg, #6d4fa0 0%, #382f52 55%, #1c2333 100%)",
};

// Real photoreal stills captured directly from each gender's live Simli
// session (apps/api/src/lib/simli.ts's SIMLI_FACE_ID_FEMALE/MALE/NEUTRAL) —
// the exact same face the builder's live avatar and a real training session
// render, not a stock photo. Used anywhere the builder shows a per-gender
// avatar image without an active WebRTC connection (option pickers, static
// panels). Re-capture these (see the avatar-builder-customization spec) if
// the underlying Simli face ids are ever rotated.
export const GENDER_PHOTOS: Record<Gender, string> = {
  FEMALE: "/avatars/gender/female.png",
  MALE: "/avatars/gender/male.png",
  NEUTRAL: "/avatars/gender/neutral.png",
};

// Style-picker thumbnails for the two non-photoreal styles (StyleStep.tsx) —
// REALISTIC uses GENDER_PHOTOS instead, since that style IS a per-gender
// Simli face. Not gender-specific: one representative preview per style.
export const STYLE_PREVIEW_PHOTOS: Partial<Record<AvatarStyle, string>> = {
  ANIMATED: "/avatars/style/animated.jpg",
  STYLIZED_3D: "/avatars/style/stylized_3d.jpeg",
};

export const HAIR_STYLE_LABELS: Record<HairStyle, string> = {
  SHORT: "Short",
  MEDIUM: "Medium",
  LONG: "Long",
  CURLY: "Curly",
  WAVY: "Wavy",
  BALD: "Bald",
};

export const VOICE_LABELS: Record<VoiceTone, string> = {
  DEEP: "Deep",
  NEUTRAL: "Neutral",
  WARM: "Warm",
};

export const VOICE_SUBTITLES: Record<VoiceTone, string> = {
  DEEP: "Bold, authoritative",
  NEUTRAL: "Clear, professional",
  WARM: "Friendly, approachable",
};

export const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  YOUNG_ADULT: "Young Adult",
  MIDDLE_AGED: "Middle-Aged",
  SENIOR: "Senior",
};

export const AVATAR_REGION_LABELS: Record<AvatarRegion, string> = {
  GLOBAL: "Global",
  INDIA: "India",
  NORTH_AMERICA: "North America",
  EUROPE: "Europe",
  MIDDLE_EAST: "Middle East",
  APAC: "Asia-Pacific",
};

export const AVATAR_LANGUAGE_LABELS: Record<AvatarLanguage, string> = {
  ENGLISH: "English",
  HINDI: "Hindi",
  SPANISH: "Spanish",
};

export const READING_LEVEL_LABELS: Record<ReadingLevel, string> = {
  SIMPLE: "Simple / Plain Language",
  STANDARD: "Standard",
  ADVANCED: "Advanced / Technical",
};

// Order matters — rendered left-to-right in that order in the picker.
export const SKIN_TONE_OPTIONS = ["TONE_1", "TONE_2", "TONE_3", "TONE_4", "TONE_5", "TONE_6"] as const;

// Sourced from @avatrain/shared so the wizard's swatch colors and
// packages/avatar-core's VRM material tinting can never drift apart — see
// SKIN_TONE_HEX/HAIR_COLOR_HEX's doc comment in
// packages/shared/src/tutor/avatar-config.ts.
export const SKIN_TONE_SWATCHES: Record<string, string> = SKIN_TONE_HEX;

export const HAIR_COLOR_OPTIONS = [
  "BLACK",
  "AUBURN",
  "COPPER",
  "BLONDE",
  "PLATINUM",
  "RED",
  "PURPLE",
  "BLUE",
] as const;

export const HAIR_COLOR_SWATCHES: Record<string, string> = HAIR_COLOR_HEX;
