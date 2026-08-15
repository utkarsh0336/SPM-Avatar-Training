// Voice AI expert catalog — maps each named persona to a real replica in
// packages/avatar-core's replicas.json so a session actually resolves to a
// working Mock/Simli avatar, not a decorative photo. SELECTABLE_VOICE_EXPERTS
// is the picker shown on the "Start a Voice Session" screen (Page 1, 3
// experts per the reference screenshot's gender set); the other entries only
// back real persisted VOICE_ONLY TrainingSession rows created against them
// (voiceExpertId) whose id isn't in SELECTABLE_VOICE_EXPERTS's picker subset.
import type { AvatarStyle, Expertise, Gender, Outfit, VoiceTone } from "@avatrain/shared/tutor";
// id/name/role come from the shared catalog (packages/shared/src/training-session/voice-experts.ts)
// — the same trustworthy lookup POST /v1/training-sessions uses server-side to resolve a
// VOICE_ONLY session's personaName/personaRole — so this file's ids/labels can't drift from what
// the API actually persists. The avatar-rendering fields below (style/gender/skinTone/...) have no
// server-side equivalent and stay dashboard-only.
import { getVoiceExpertSummaryById, type VoiceExpertSummary } from "@avatrain/shared/training-session";

function summary(id: string): VoiceExpertSummary {
  const found = getVoiceExpertSummaryById(id);
  if (!found) throw new Error(`voice-experts.ts: no shared VoiceExpertSummary for id "${id}"`);
  return found;
}

export interface VoiceExpert {
  id: string;
  name: string;
  /** Short label — expert card subtitle, live-stage subtitle, history-item subtitle. */
  role: string;
  /** Longer phrase — the live-session header pill and the WS session.start's cosmetic `topic` field. */
  topic: string;
  style: AvatarStyle;
  gender: Gender;
  /** Token, not a hex value — resolved to a hex paint color via @avatrain/avatar-core's SKIN_TONE_HEX/HAIR_COLOR_HEX at session-start, same as an onboarding-built Avatar record. */
  skinTone: string;
  hairStyle: string;
  hairColor: string;
  outfit: Outfit;
  expertise: Expertise;
  voiceTone: VoiceTone;
  photoSrc: string;
}

const PRIYA: VoiceExpert = {
  ...summary("priya"),
  topic: "HR & Leave Policy",
  style: "REALISTIC",
  gender: "FEMALE",
  skinTone: "TONE_3",
  hairStyle: "LONG",
  hairColor: "BLACK",
  outfit: "BUSINESS_FORMAL",
  expertise: "HR_LEAVE_POLICY",
  voiceTone: "WARM",
  photoSrc: "/avatars/gender/female.png",
};

const MARCUS: VoiceExpert = {
  ...summary("marcus"),
  topic: "Sales & Negotiation",
  style: "REALISTIC",
  gender: "MALE",
  skinTone: "TONE_2",
  hairStyle: "SHORT",
  hairColor: "BLACK",
  outfit: "BUSINESS_CASUAL",
  expertise: "SALES_NEGOTIATION",
  voiceTone: "DEEP",
  photoSrc: "/avatars/gender/male.png",
};

const KIRAN: VoiceExpert = {
  ...summary("kiran"),
  topic: "Product Training",
  style: "ANIMATED",
  gender: "NEUTRAL",
  skinTone: "TONE_4",
  hairStyle: "MEDIUM",
  hairColor: "COPPER",
  outfit: "TECH_CREATIVE",
  expertise: "PRODUCT_TRAINING",
  voiceTone: "NEUTRAL",
  photoSrc: "/avatars/gender/neutral.png",
};

const SHREYA: VoiceExpert = {
  ...summary("shreya"),
  topic: "Compliance & Legal",
  style: "STYLIZED_3D",
  gender: "FEMALE",
  skinTone: "TONE_5",
  hairStyle: "LONG",
  hairColor: "AUBURN",
  outfit: "ACADEMIC_EDUCATOR",
  expertise: "COMPLIANCE_LEGAL",
  voiceTone: "NEUTRAL",
  photoSrc: "/avatars/gender/female.png",
};

const ANANYA: VoiceExpert = {
  ...summary("ananya"),
  topic: "Product Training",
  style: "REALISTIC",
  gender: "FEMALE",
  skinTone: "TONE_2",
  hairStyle: "WAVY",
  hairColor: "BLACK",
  outfit: "BUSINESS_FORMAL",
  expertise: "PRODUCT_TRAINING",
  voiceTone: "WARM",
  photoSrc: "/avatars/gender/female.png",
};

const DAVID: VoiceExpert = {
  ...summary("david"),
  topic: "Customer Support",
  style: "REALISTIC",
  gender: "MALE",
  skinTone: "TONE_3",
  hairStyle: "SHORT",
  hairColor: "BLONDE",
  outfit: "BUSINESS_CASUAL",
  expertise: "CUSTOMER_SUPPORT",
  voiceTone: "DEEP",
  photoSrc: "/avatars/gender/male.png",
};

/** Shown on the "Choose your AI expert" picker — one per gender image (Male, Female, Neutral). */
export const SELECTABLE_VOICE_EXPERTS: VoiceExpert[] = [PRIYA, MARCUS, KIRAN];

/** Includes pickable experts plus the personas referenced by existing history items. */
export const ALL_VOICE_EXPERTS: VoiceExpert[] = [PRIYA, MARCUS, KIRAN, SHREYA, ANANYA, DAVID];

export function getVoiceExpertById(id: string): VoiceExpert | undefined {
  return ALL_VOICE_EXPERTS.find((expert) => expert.id === id);
}
