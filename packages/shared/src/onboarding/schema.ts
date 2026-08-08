import { z } from "zod";
import {
  avatarStyleSchema,
  genderSchema as avatarGenderSchema,
  outfitSchema,
  expertiseSchema,
  voiceToneSchema,
} from "../tutor/avatar-config.js";

export { avatarStyleSchema, avatarGenderSchema, outfitSchema, expertiseSchema, voiceToneSchema };

export const hairStyleSchema = z.enum(["SHORT", "MEDIUM", "LONG", "CURLY", "WAVY", "BALD"]);
export type HairStyleValue = z.infer<typeof hairStyleSchema>;

// Application-layer allowlists — `avatars.skin_tone`/`hair_color` are plain
// Postgres TEXT columns, not enums, so the palette can change without a
// migration. See .claude/specs/onboarding.md's Database Changes. Values must
// stay in sync with apps/dashboard/app/onboarding/types.ts's
// SKIN_TONE_OPTIONS/HAIR_COLOR_OPTIONS — schema.test.ts drift-guards this,
// same convention as tutor/avatar-config.test.ts.
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

export const avatarPreviewProviderSchema = z.enum(["NONE", "READY_PLAYER_ME"]);
export type AvatarPreviewProvider = z.infer<typeof avatarPreviewProviderSchema>;

// Host allowlist for vendor-returned preview asset URLs — PATCH must reject
// any URL whose host isn't listed here, so a malicious/misbehaving
// postMessage sender can't get an arbitrary URL persisted (see
// .claude/rules/tenancy.md's "never trust client input for anything that
// gates state" posture, and avatar-builder-customization.md Implementation
// Rules). models.readyplayer.me is Ready Player Me's documented public
// GLB-asset CDN host — reconfirm against a live account before the optional
// generate-avatar flow is wired up (Implementation Assumptions #2).
export const AVATAR_PREVIEW_URL_ALLOWED_HOSTS = ["models.readyplayer.me"] as const;

function isAllowedPreviewUrl(value: string): boolean {
  try {
    return (AVATAR_PREVIEW_URL_ALLOWED_HOSTS as readonly string[]).includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

const avatarPreviewUrlSchema = z
  .string()
  .url()
  .refine(isAllowedPreviewUrl, { message: "avatar preview URL host is not allowlisted" });

// Name charset/length per onboarding.md Step 5: letters (incl. accented),
// numbers, spaces, and - ' . only, 2-60 chars after trim.
export const avatarNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[\p{L}0-9 '.-]+$/u, "invalid characters in avatar name");

// All fields optional — a draft can be partially filled at any point in the
// wizard. Used for both the GET response body and the PATCH request/response
// body of /v1/onboarding.
export const onboardingDraftSchema = z.object({
  name: avatarNameSchema.optional(),
  style: avatarStyleSchema.optional(),
  gender: avatarGenderSchema.optional(),
  skinTone: skinToneSchema.optional(),
  hairStyle: hairStyleSchema.optional(),
  hairColor: hairColorSchema.optional(),
  outfit: outfitSchema.optional(),
  expertise: expertiseSchema.optional(),
  voice: voiceToneSchema.optional(),
  lastVisitedStep: z.number().int().min(1).max(6).optional(),
  // Additive preview fields (avatar-builder-customization.md) — deliberately
  // never required by onboardingCompleteRequiredSchema below.
  previewProvider: avatarPreviewProviderSchema.optional(),
  externalAvatarId: z.string().min(1).max(200).optional(),
  avatarModelUrl: avatarPreviewUrlSchema.nullable().optional(),
  avatarSnapshotUrl: avatarPreviewUrlSchema.nullable().optional(),
});
export type OnboardingDraftInput = z.infer<typeof onboardingDraftSchema>;

// Every field onboarding.md's original 6 steps require to complete — the 4
// preview fields are deliberately absent so POST /complete never depends on
// the optional vendor path. See Implementation Rules in
// avatar-builder-customization.md.
export const onboardingCompleteRequiredSchema = z.object({
  name: avatarNameSchema,
  style: avatarStyleSchema,
  gender: avatarGenderSchema,
  skinTone: skinToneSchema,
  hairStyle: hairStyleSchema,
  hairColor: hairColorSchema,
  outfit: outfitSchema,
  expertise: expertiseSchema,
  voice: voiceToneSchema,
});
export type OnboardingCompleteRequired = z.infer<typeof onboardingCompleteRequiredSchema>;

// Response body shape for GET/PATCH /v1/onboarding — used client-side
// (apps/dashboard/lib/api-client.ts) to validate what apps/api returns,
// mirroring api-client.ts's existing conversationTicketResultSchema pattern.
export const onboardingDraftResponseSchema = z.object({
  name: z.string().nullable(),
  style: avatarStyleSchema.nullable(),
  gender: avatarGenderSchema.nullable(),
  skinTone: skinToneSchema.nullable(),
  hairStyle: hairStyleSchema.nullable(),
  hairColor: hairColorSchema.nullable(),
  outfit: outfitSchema.nullable(),
  expertise: expertiseSchema.nullable(),
  voice: voiceToneSchema.nullable(),
  status: z.enum(["DRAFT", "ACTIVE"]),
  lastVisitedStep: z.number().int(),
  previewProvider: avatarPreviewProviderSchema,
  externalAvatarId: z.string().nullable(),
  avatarModelUrl: z.string().nullable(),
  avatarSnapshotUrl: z.string().nullable(),
  previewGeneratedAt: z.string().nullable(),
  // Pinned server-side once at draft creation from SIMLI_FACE_ID — see
  // prisma/schema.prisma's Avatar.simliFaceId doc comment. Read-only from
  // the client's perspective; never accepted by onboardingDraftSchema.
  simliFaceId: z.string().nullable(),
});
export type OnboardingDraftResponse = z.infer<typeof onboardingDraftResponseSchema>;

export const onboardingCompleteResponseSchema = z.object({ avatarId: z.string().uuid() });
export type OnboardingCompleteResponse = z.infer<typeof onboardingCompleteResponseSchema>;
