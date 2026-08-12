import { z } from "zod";

// Mirrors prisma/schema.prisma's ObjectiveProgressVerdict enum — redefined
// here rather than imported from @prisma/client so packages/shared stays
// browser-bundleable (same reasoning as ../knowledge/schema.ts's
// knowledgeDocumentStatusSchema).
export const objectiveProgressVerdictSchema = z.enum(["PASS", "RETRY"]);
export type ObjectiveProgressVerdict = z.infer<typeof objectiveProgressVerdictSchema>;

export const objectiveSchema = z.object({
  id: z.string().uuid(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  teachingContent: z.string(),
  checkQuestion: z.string(),
  gradingCriteria: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ObjectiveResult = z.infer<typeof objectiveSchema>;

/**
 * Item shape for PUT /v1/curricula/:id/objectives — replace-the-whole-list
 * semantics (see .claude/specs/interactive-assessment.md's API Changes): id
 * present means "update this existing objective" (curriculum-service
 * verifies it actually belongs to the target curriculum before touching
 * it), id absent means "create a new one". Array position encodes order,
 * not an explicit field, since the trainer edits and saves the full
 * ordered list in one call. No prior "ordered list with stable ids for
 * diffing" pattern existed elsewhere in this package — this is the first.
 */
export const objectiveInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1),
  teachingContent: z.string().min(1),
  checkQuestion: z.string().min(1),
  gradingCriteria: z.string().min(1),
});
export type ObjectiveInput = z.infer<typeof objectiveInputSchema>;

export const curriculumSchema = z.object({
  id: z.string().uuid(),
  avatarId: z.string().uuid(),
  title: z.string(),
  objectives: z.array(objectiveSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CurriculumResult = z.infer<typeof curriculumSchema>;

export const createCurriculumRequestSchema = z.object({
  avatarId: z.string().uuid(),
  title: z.string().min(1),
});
export type CreateCurriculumRequest = z.infer<typeof createCurriculumRequestSchema>;

export const createCurriculumResponseSchema = z.object({
  id: z.string().uuid(),
  avatarId: z.string().uuid(),
  title: z.string(),
});
export type CreateCurriculumResponse = z.infer<typeof createCurriculumResponseSchema>;

export const curriculumIdParamSchema = z.object({
  curriculumId: z.string().uuid(),
});
export type CurriculumIdParam = z.infer<typeof curriculumIdParamSchema>;

export const replaceCurriculumObjectivesRequestSchema = z.object({
  objectives: z.array(objectiveInputSchema).min(1),
});
export type ReplaceCurriculumObjectivesRequest = z.infer<typeof replaceCurriculumObjectivesRequestSchema>;

export const replaceCurriculumObjectivesResponseSchema = z.object({
  objectives: z.array(objectiveSchema),
});
export type ReplaceCurriculumObjectivesResponse = z.infer<typeof replaceCurriculumObjectivesResponseSchema>;

export const objectiveProgressEntrySchema = z.object({
  objectiveId: z.string().uuid(),
  objectiveTitle: z.string(),
  learnerId: z.string().uuid(),
  learnerEmail: z.string(),
  verdict: objectiveProgressVerdictSchema,
  attempts: z.number().int().positive(),
  feedback: z.string(),
  updatedAt: z.string(),
});
export type ObjectiveProgressEntry = z.infer<typeof objectiveProgressEntrySchema>;

export const listCurriculumProgressResponseSchema = z.object({
  progress: z.array(objectiveProgressEntrySchema),
});
export type ListCurriculumProgressResponse = z.infer<typeof listCurriculumProgressResponseSchema>;

/**
 * Minimal avatar summary powering the Curriculum admin page's avatar
 * picker (GET /v1/avatars) — kept here rather than a new subpath since
 * this page is its only consumer today; a fuller avatar-listing contract
 * is avatar-builder-customization.md's territory if a second consumer
 * ever needs one.
 */
export const avatarSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Null if this avatar has no Curriculum yet — lets the picker route to create vs. edit. */
  curriculumId: z.string().uuid().nullable(),
});
export type AvatarSummary = z.infer<typeof avatarSummarySchema>;

export const listAvatarsResponseSchema = z.object({
  avatars: z.array(avatarSummarySchema),
});
export type ListAvatarsResponse = z.infer<typeof listAvatarsResponseSchema>;
