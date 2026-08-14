import { z } from "zod";
import { objectiveProgressVerdictSchema } from "./verdict-schema.js";

// Owned by .claude/specs/branching-scenario-questions.md. An optional, ordered branching
// scenario attached to one Objective — replaces its flat checkQuestion/gradingCriteria for
// checkpointing when present; an Objective with zero steps behaves exactly as
// interactive-assessment.md defined.

export const scenarioBranchResultSchema = z.object({
  id: z.string().uuid(),
  order: z.number().int().nonnegative(),
  matchCriteria: z.string(),
  /** Continues the scenario to another step. Exactly one of nextStepId/outcome is set. */
  nextStepId: z.string().uuid().nullable(),
  /** Terminates the scenario with this verdict, feeding record_progress like grade_answer does. */
  outcome: objectiveProgressVerdictSchema.nullable(),
});
export type ScenarioBranchResult = z.infer<typeof scenarioBranchResultSchema>;

export const scenarioStepResultSchema = z.object({
  id: z.string().uuid(),
  order: z.number().int().nonnegative(),
  prompt: z.string(),
  branches: z.array(scenarioBranchResultSchema),
});
export type ScenarioStepResult = z.infer<typeof scenarioStepResultSchema>;

/**
 * Branch shape for PUT /v1/objectives/:objectiveId/scenario — nextStepOrder references another
 * step's `order` within THIS payload (not a DB id — steps are recreated on every save, so a real
 * nextStepId doesn't exist yet when the client builds this request). Exactly one of
 * nextStepOrder/outcome must be set.
 */
export const scenarioBranchInputSchema = z
  .object({
    order: z.number().int().nonnegative(),
    matchCriteria: z.string().min(1),
    nextStepOrder: z.number().int().nonnegative().nullable(),
    outcome: objectiveProgressVerdictSchema.nullable(),
  })
  .refine((branch) => (branch.nextStepOrder === null) !== (branch.outcome === null), {
    message: "exactly one of nextStepOrder or outcome must be set",
  });
export type ScenarioBranchInput = z.infer<typeof scenarioBranchInputSchema>;

export const scenarioStepInputSchema = z.object({
  order: z.number().int().nonnegative(),
  prompt: z.string().min(1),
  branches: z.array(scenarioBranchInputSchema).min(1),
});
export type ScenarioStepInput = z.infer<typeof scenarioStepInputSchema>;

/** steps: [] clears an objective's scenario — it falls back to checkQuestion/gradingCriteria. */
export const replaceObjectiveScenarioRequestSchema = z.object({
  steps: z.array(scenarioStepInputSchema),
});
export type ReplaceObjectiveScenarioRequest = z.infer<typeof replaceObjectiveScenarioRequestSchema>;

export const replaceObjectiveScenarioResponseSchema = z.object({
  steps: z.array(scenarioStepResultSchema),
});
export type ReplaceObjectiveScenarioResponse = z.infer<typeof replaceObjectiveScenarioResponseSchema>;

export const objectiveIdParamSchema = z.object({
  objectiveId: z.string().uuid(),
});
export type ObjectiveIdParam = z.infer<typeof objectiveIdParamSchema>;
