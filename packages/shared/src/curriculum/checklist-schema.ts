import { z } from "zod";

// Owned by .claude/specs/induction-checklist.md. A structured,
// non-conversational task list attached to a Curriculum — distinct from
// Objective's AI-graded checkpoints (interactive-assessment.md) and from
// .claude/specs/onboarding.md's trainer-facing avatar-configuration wizard.

/**
 * Item shape for PUT /v1/curricula/:curriculumId/checklist/items —
 * replace-the-whole-list semantics, same convention as
 * ../curriculum/schema.ts's objectiveInputSchema: id present means "update
 * this existing item", id absent means "create a new one". Array position
 * encodes order.
 */
export const checklistItemInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
});
export type ChecklistItemInput = z.infer<typeof checklistItemInputSchema>;

/**
 * A checklist item as returned to a caller — `completed` is resolved
 * per-caller from ChecklistItemProgress, not a column on ChecklistItem
 * itself (self-attested completion is per-learner, like ObjectiveProgress).
 */
export const checklistItemResultSchema = z.object({
  id: z.string().uuid(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  description: z.string().nullable(),
  completed: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChecklistItemResult = z.infer<typeof checklistItemResultSchema>;

export const checklistResultSchema = z.object({
  id: z.string().uuid(),
  curriculumId: z.string().uuid(),
  title: z.string(),
  items: z.array(checklistItemResultSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChecklistResult = z.infer<typeof checklistResultSchema>;

export const createChecklistRequestSchema = z.object({
  title: z.string().min(1),
});
export type CreateChecklistRequest = z.infer<typeof createChecklistRequestSchema>;

export const createChecklistResponseSchema = z.object({
  id: z.string().uuid(),
  curriculumId: z.string().uuid(),
  title: z.string(),
});
export type CreateChecklistResponse = z.infer<typeof createChecklistResponseSchema>;

export const replaceChecklistItemsRequestSchema = z.object({
  items: z.array(checklistItemInputSchema).min(1),
});
export type ReplaceChecklistItemsRequest = z.infer<typeof replaceChecklistItemsRequestSchema>;

export const replaceChecklistItemsResponseSchema = z.object({
  items: z.array(checklistItemResultSchema),
});
export type ReplaceChecklistItemsResponse = z.infer<typeof replaceChecklistItemsResponseSchema>;

export const checklistItemIdParamSchema = z.object({
  itemId: z.string().uuid(),
});
export type ChecklistItemIdParam = z.infer<typeof checklistItemIdParamSchema>;

/** PATCH /v1/checklist-items/:itemId/complete body. */
export const completeChecklistItemRequestSchema = z.object({
  completed: z.boolean(),
});
export type CompleteChecklistItemRequest = z.infer<typeof completeChecklistItemRequestSchema>;

export const completeChecklistItemResponseSchema = z.object({
  itemId: z.string().uuid(),
  completed: z.boolean(),
  completedAt: z.string().nullable(),
});
export type CompleteChecklistItemResponse = z.infer<typeof completeChecklistItemResponseSchema>;
