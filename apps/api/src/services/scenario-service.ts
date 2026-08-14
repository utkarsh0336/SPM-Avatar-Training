import {
  withOrg,
  type ScenarioBranchResult,
  type ScenarioStepInput,
  type ScenarioStepResult,
} from "@avatrain/shared";
import type { ScenarioStep } from "@prisma/client";
import { badRequest, notFound } from "../lib/http-errors.js";

/**
 * Cross-step validation that can't be expressed as a per-branch Zod refine (schema.ts's
 * scenarioBranchInputSchema only checks a single branch in isolation): every nextStepOrder must
 * reference a step.order present in this same payload, and step/branch orders must be unique.
 * Mirrors curriculum-service.ts's replaceObjectives own badRequest("objective_not_found", ...)
 * precedent for cross-referential checks living in the service layer, not Zod.
 */
function validateScenarioSteps(steps: ScenarioStepInput[]): void {
  const stepOrders = new Set<number>();
  for (const step of steps) {
    if (stepOrders.has(step.order)) {
      throw badRequest("invalid_scenario", `duplicate step order ${step.order}`);
    }
    stepOrders.add(step.order);
  }

  for (const step of steps) {
    const branchOrders = new Set<number>();
    for (const branch of step.branches) {
      if (branchOrders.has(branch.order)) {
        throw badRequest("invalid_scenario", `duplicate branch order ${branch.order} in step ${step.order}`);
      }
      branchOrders.add(branch.order);
      if (branch.nextStepOrder !== null && !stepOrders.has(branch.nextStepOrder)) {
        throw badRequest(
          "invalid_scenario",
          `branch in step ${step.order} points to nextStepOrder ${branch.nextStepOrder}, which is not in this payload`,
        );
      }
    }
  }
}

/**
 * PUT /v1/objectives/:objectiveId/scenario — OWNER-only. Replace-the-whole-scenario semantics,
 * same convention as curriculum-service.ts's replaceObjectives: always deletes and recreates the
 * full step set for this objective in one transaction, so a branch never dangles pointing at a
 * step being edited out mid-save. steps: [] clears the scenario (objective falls back to its flat
 * checkQuestion/gradingCriteria). See .claude/specs/branching-scenario-questions.md.
 */
export async function replaceObjectiveScenario(
  orgId: string,
  objectiveId: string,
  steps: ScenarioStepInput[],
): Promise<ScenarioStepResult[]> {
  validateScenarioSteps(steps);

  return withOrg(orgId, async (tx) => {
    const objective = await tx.objective.findFirst({ where: { id: objectiveId, orgId } });
    if (!objective) throw notFound("objective_not_found");

    // Cascades ScenarioBranch rows both directions (fromStepId always; nextStepId is
    // ON DELETE SET NULL, harmless since every step for this objective is being replaced).
    await tx.scenarioStep.deleteMany({ where: { objectiveId, orgId } });

    const orderToId = new Map<number, string>();
    const createdSteps: ScenarioStep[] = [];
    for (const step of steps) {
      const created = await tx.scenarioStep.create({
        data: { orgId, objectiveId, order: step.order, prompt: step.prompt },
      });
      orderToId.set(step.order, created.id);
      createdSteps.push(created);
    }

    const branchesByStepId = new Map<string, ScenarioBranchResult[]>();
    for (const step of steps) {
      const stepId = orderToId.get(step.order)!;
      const branchResults: ScenarioBranchResult[] = [];
      for (const branch of step.branches) {
        const created = await tx.scenarioBranch.create({
          data: {
            orgId,
            fromStepId: stepId,
            order: branch.order,
            matchCriteria: branch.matchCriteria,
            nextStepId: branch.nextStepOrder !== null ? orderToId.get(branch.nextStepOrder)! : null,
            outcome: branch.outcome,
          },
        });
        branchResults.push({
          id: created.id,
          order: created.order,
          matchCriteria: created.matchCriteria,
          nextStepId: created.nextStepId,
          outcome: created.outcome,
        });
      }
      branchesByStepId.set(stepId, branchResults);
    }

    return createdSteps
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ id: s.id, order: s.order, prompt: s.prompt, branches: branchesByStepId.get(s.id) ?? [] }));
  });
}
