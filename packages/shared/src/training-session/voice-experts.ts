/**
 * Server-side-trustworthy id/name/role lookup for VOICE_ONLY training sessions — the counterpart
 * to how an avatarId resolves to a name/expertise via avatar-service.ts's getAvatarById for
 * VIDEO_CHAT sessions (there is no VoiceExpert table; this catalog is code, not tenant data).
 * apps/dashboard/lib/fixtures/voice-experts.ts's fuller VoiceExpert catalog (avatar-rendering
 * fields: style/gender/skinTone/hairStyle/...) stays dashboard-only and imports the id/name/role
 * triplet from here rather than duplicating it, so the two can't drift.
 */
export interface VoiceExpertSummary {
  id: string;
  name: string;
  role: string;
}

export const VOICE_EXPERT_SUMMARIES: VoiceExpertSummary[] = [
  { id: "priya", name: "Priya", role: "HR Expert" },
  { id: "marcus", name: "Marcus", role: "Sales Coach" },
  { id: "kiran", name: "Kiran", role: "Product Specialist" },
  { id: "shreya", name: "Shreya", role: "Compliance" },
  { id: "ananya", name: "Ananya", role: "Product" },
  { id: "david", name: "David", role: "Support" },
];

export function getVoiceExpertSummaryById(id: string): VoiceExpertSummary | undefined {
  return VOICE_EXPERT_SUMMARIES.find((expert) => expert.id === id);
}
