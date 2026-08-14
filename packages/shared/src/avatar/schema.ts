import { z } from "zod";
import {
  avatarStyleSchema,
  genderSchema,
  outfitSchema,
  expertiseSchema,
  voiceToneSchema,
  hairStyleSchema,
  skinToneSchema,
  hairColorSchema,
  ageGroupSchema,
  avatarRegionSchema,
  avatarLanguageSchema,
  readingLevelSchema,
} from "../tutor/avatar-config.js";

export const avatarIdParamSchema = z.object({ avatarId: z.string().uuid() });
export type AvatarIdParam = z.infer<typeof avatarIdParamSchema>;

/**
 * The full persisted Avatar record, for consumers that need more than
 * curriculum/schema.ts's avatarSummarySchema (id/name/curriculumId only) —
 * concretely, a live session resolving its persona from an avatarId
 * (GET /v1/avatars/mine, GET /v1/avatars/:avatarId) instead of the old
 * localStorage handoff. See onboarding/schema.ts's onboardingDraftResponseSchema
 * for the equivalent shape scoped to the wizard's own single draft; this is
 * the same fields, for any of an org's (potentially several) avatars.
 */
export const avatarRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  style: avatarStyleSchema.nullable(),
  gender: genderSchema.nullable(),
  skinTone: skinToneSchema.nullable(),
  hairStyle: hairStyleSchema.nullable(),
  hairColor: hairColorSchema.nullable(),
  outfit: outfitSchema.nullable(),
  expertise: expertiseSchema.nullable(),
  voice: voiceToneSchema.nullable(),
  ageGroup: ageGroupSchema.nullable(),
  region: avatarRegionSchema.nullable(),
  preferredLanguage: avatarLanguageSchema.nullable(),
  readingLevel: readingLevelSchema.nullable(),
  // ARCHIVED added for multi-persona management's soft-delete — see
  // prisma/schema.prisma's AvatarStatus.ARCHIVED doc comment.
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  simliFaceId: z.string().nullable(),
  // Only populated by GET /v1/avatars/:avatarId — resolves this avatar's
  // Curriculum for .claude/specs/induction-checklist.md's ChecklistPanel
  // (a rehearsal session only knows its avatarId, not a curriculumId).
  // Optional so getMyAvatars/listOrgAvatars' plain findMany responses
  // (which don't fetch the curriculum relation) still validate.
  curriculumId: z.string().uuid().nullable().optional(),
});
export type AvatarRecord = z.infer<typeof avatarRecordSchema>;

export const listMyAvatarsResponseSchema = z.object({
  avatars: z.array(avatarRecordSchema),
});
export type ListMyAvatarsResponse = z.infer<typeof listMyAvatarsResponseSchema>;

export const getAvatarResponseSchema = z.object({ avatar: avatarRecordSchema });
export type GetAvatarResponse = z.infer<typeof getAvatarResponseSchema>;

/**
 * POST /v1/avatars — no required body. Creates a blank DRAFT persona the
 * caller then fills in via PATCH /v1/avatars/:avatarId, the same
 * progressive-fill shape onboarding's own draft already uses. An optional
 * `name` lets a caller seed a display name immediately (e.g. "New persona"
 * vs. a picker having to show "Untitled Avatar" for one render cycle).
 */
export const createAvatarRequestSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
});
export type CreateAvatarRequest = z.infer<typeof createAvatarRequestSchema>;
