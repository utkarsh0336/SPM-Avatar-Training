import { z } from "zod";
import { scenarioStepResultSchema } from "./scenario-schema.js";
import { objectiveProgressVerdictSchema } from "./verdict-schema.js";

// objectiveProgressVerdictSchema/ObjectiveProgressVerdict now live in verdict-schema.js (barrel
// re-exports it) — pulled out of this file so it and scenario-schema.js don't import each other.

// Mirrors prisma/schema.prisma's ProgramType enum, same redefinition
// convention as objectiveProgressVerdictSchema above. See
// .claude/specs/training-catalog.md.
export const programTypeSchema = z.enum([
  "EMPLOYEE_ONBOARDING",
  "COMPLIANCE_TRAINING",
  "CUSTOMER_EDUCATION",
  "PARTNER_ENABLEMENT",
]);
export type ProgramType = z.infer<typeof programTypeSchema>;

export const objectiveSchema = z.object({
  id: z.string().uuid(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  teachingContent: z.string(),
  checkQuestion: z.string(),
  gradingCriteria: z.string(),
  // Empty = no branching scenario, the flat checkQuestion/gradingCriteria path above applies.
  // See .claude/specs/branching-scenario-questions.md.
  scenarioSteps: z.array(scenarioStepResultSchema),
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
  // Nullable, not optional — "uncategorized" is a real, displayable state
  // (see .claude/specs/training-catalog.md), not an absent field.
  programType: programTypeSchema.nullable(),
  // Trainer opt-in: when true, session.start presents this curriculum's objectives to each
  // learner in mastery-weighted order instead of strict authored order. Default false. See
  // .claude/specs/adaptive-learning-paths.md.
  adaptiveOrderingEnabled: z.boolean(),
  objectives: z.array(objectiveSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CurriculumResult = z.infer<typeof curriculumSchema>;

export const createCurriculumRequestSchema = z.object({
  avatarId: z.string().uuid(),
  title: z.string().min(1),
  programType: programTypeSchema.optional(),
});
export type CreateCurriculumRequest = z.infer<typeof createCurriculumRequestSchema>;

export const createCurriculumResponseSchema = z.object({
  id: z.string().uuid(),
  avatarId: z.string().uuid(),
  title: z.string(),
  programType: programTypeSchema.nullable(),
});
export type CreateCurriculumResponse = z.infer<typeof createCurriculumResponseSchema>;

export const curriculumIdParamSchema = z.object({
  curriculumId: z.string().uuid(),
});
export type CurriculumIdParam = z.infer<typeof curriculumIdParamSchema>;

// PATCH /v1/curricula/:curriculumId body. An explicit `null` for
// programType clears it back to "uncategorized"; an omitted field leaves it
// untouched — same convention as ../knowledge/schema.ts's
// updateKnowledgeDocumentSchema.
export const updateCurriculumRequestSchema = z.object({
  title: z.string().min(1).optional(),
  programType: programTypeSchema.nullable().optional(),
  adaptiveOrderingEnabled: z.boolean().optional(),
});
export type UpdateCurriculumRequest = z.infer<typeof updateCurriculumRequestSchema>;

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

// GET /v1/curricula/:curriculumId/effectiveness — aggregates the same
// ObjectiveProgress rows listCurriculumProgress returns raw, into
// completion/mastery/time-to-competency stats. See
// .claude/specs/training-effectiveness-measurement.md.
export const objectiveEffectivenessSchema = z.object({
  objectiveId: z.string().uuid(),
  objectiveTitle: z.string(),
  order: z.number().int().nonnegative(),
  attemptedLearnerCount: z.number().int().nonnegative(),
  passedLearnerCount: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1),
  avgAttemptsToPass: z.number().nullable(),
  avgTimeToCompetencySeconds: z.number().nullable(),
});
export type ObjectiveEffectiveness = z.infer<typeof objectiveEffectivenessSchema>;

// objectives is ordered by Objective.order — reading pass rate down this
// array is the "mastery trend": where learners stall as they progress
// through the curriculum, without a new time-series/event table.
export const curriculumEffectivenessSchema = z.object({
  curriculumId: z.string().uuid(),
  learnerCount: z.number().int().nonnegative(),
  completedLearnerCount: z.number().int().nonnegative(),
  completionRate: z.number().min(0).max(1),
  avgTimeToCompetencySeconds: z.number().nullable(),
  objectives: z.array(objectiveEffectivenessSchema),
});
export type CurriculumEffectiveness = z.infer<typeof curriculumEffectivenessSchema>;

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
  /** Mirrors the attached Curriculum's programType; null if no Curriculum yet or uncategorized. */
  programType: programTypeSchema.nullable(),
});
export type AvatarSummary = z.infer<typeof avatarSummarySchema>;

export const listAvatarsResponseSchema = z.object({
  avatars: z.array(avatarSummarySchema),
});
export type ListAvatarsResponse = z.infer<typeof listAvatarsResponseSchema>;

/**
 * GET /v1/curricula — org-wide listing added by
 * .claude/specs/partner-role.md. OWNER sees every curriculum; PARTNER sees
 * only PARTNER_ENABLEMENT ones (filtered server-side, see
 * curriculum-service.ts's listCurricula).
 */
export const curriculumSummarySchema = z.object({
  id: z.string().uuid(),
  avatarId: z.string().uuid(),
  avatarName: z.string(),
  title: z.string(),
  programType: programTypeSchema.nullable(),
  objectiveCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CurriculumSummary = z.infer<typeof curriculumSummarySchema>;

export const listCurriculaResponseSchema = z.object({
  curricula: z.array(curriculumSummarySchema),
});
export type ListCurriculaResponse = z.infer<typeof listCurriculaResponseSchema>;
