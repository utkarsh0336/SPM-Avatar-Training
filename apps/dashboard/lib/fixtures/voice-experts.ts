// Voice AI expert catalog — maps each named persona to a real replica in
// packages/avatar-core's replicas.json so a session actually resolves to a
// working Mock/Simli avatar, not a decorative photo. SELECTABLE_VOICE_EXPERTS
// is the picker shown on the "Start a Voice Session" screen (Page 1, 3
// experts per the reference screenshot's gender set); the other entries only
// back existing history items in mock-voice-sessions.ts.
import type { AvatarStyle, Expertise, Gender, Outfit, VoiceTone } from "@avatrain/shared/tutor";

export interface VoiceExpert {
  id: string;
  name: string;
  /** Short label — expert card subtitle, live-stage subtitle, history-item subtitle. */
  role: string;
  /** Longer phrase — the live-session header pill and the WS session.start's cosmetic `topic` field. */
  topic: string;
  style: AvatarStyle;
  gender: Gender;
  outfit: Outfit;
  expertise: Expertise;
  voiceTone: VoiceTone;
  photoSrc: string;
}

const PRIYA: VoiceExpert = {
  id: "priya",
  name: "Priya",
  role: "HR Expert",
  topic: "HR & Leave Policy",
  style: "REALISTIC",
  gender: "FEMALE",
  outfit: "BUSINESS_FORMAL",
  expertise: "HR_LEAVE_POLICY",
  voiceTone: "WARM",
  photoSrc: "/avatars/gender/female.png",
};

const MARCUS: VoiceExpert = {
  id: "marcus",
  name: "Marcus",
  role: "Sales Coach",
  topic: "Sales & Negotiation",
  style: "REALISTIC",
  gender: "MALE",
  outfit: "BUSINESS_CASUAL",
  expertise: "SALES_NEGOTIATION",
  voiceTone: "DEEP",
  photoSrc: "/avatars/gender/male.png",
};

const KIRAN: VoiceExpert = {
  id: "kiran",
  name: "Kiran",
  role: "Product Specialist",
  topic: "Product Training",
  style: "ANIMATED",
  gender: "NEUTRAL",
  outfit: "TECH_CREATIVE",
  expertise: "PRODUCT_TRAINING",
  voiceTone: "NEUTRAL",
  photoSrc: "/avatars/gender/neutral.png",
};

const SHREYA: VoiceExpert = {
  id: "shreya",
  name: "Shreya",
  role: "Compliance",
  topic: "Compliance & Legal",
  style: "STYLIZED_3D",
  gender: "FEMALE",
  outfit: "ACADEMIC_EDUCATOR",
  expertise: "COMPLIANCE_LEGAL",
  voiceTone: "NEUTRAL",
  photoSrc: "/avatars/gender/female.png",
};

const ANANYA: VoiceExpert = {
  id: "ananya",
  name: "Ananya",
  role: "Product",
  topic: "Product Training",
  style: "REALISTIC",
  gender: "FEMALE",
  outfit: "BUSINESS_FORMAL",
  expertise: "PRODUCT_TRAINING",
  voiceTone: "WARM",
  photoSrc: "/avatars/gender/female.png",
};

const DAVID: VoiceExpert = {
  id: "david",
  name: "David",
  role: "Support",
  topic: "Customer Support",
  style: "REALISTIC",
  gender: "MALE",
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
