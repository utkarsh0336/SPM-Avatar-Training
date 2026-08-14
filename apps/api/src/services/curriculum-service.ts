import {
  isUniqueConstraintError,
  withOrg,
  type CreateCurriculumRequest,
  type CreateCurriculumResponse,
  type CurriculumEffectiveness,
  type CurriculumResult,
  type ObjectiveEffectiveness,
  type ObjectiveInput,
  type ObjectiveMasteryStatus,
  type ObjectiveProgressEntry,
  type ObjectiveProgressVerdict,
  type ObjectiveResult,
  type Role,
  type ScenarioStepResult,
  type UpdateCurriculumRequest,
} from "@avatrain/shared";
import type { Curriculum, Objective } from "@prisma/client";
import { badRequest, conflict, notFound } from "../lib/http-errors.js";

/**
 * A PARTNER may only reach a curriculum tagged PARTNER_ENABLEMENT
 * (.claude/specs/training-catalog.md) — everything else is invisible to
 * them, not merely forbidden: throwing notFound rather than a 403 for a
 * curriculum that DOES exist in their own org prevents a PARTNER from
 * distinguishing "exists but not mine" from "doesn't exist" by probing ids,
 * mirroring .claude/rules/tenancy.md's "return zero rows" isolation
 * convention. OWNER is unrestricted. See .claude/specs/partner-role.md.
 */
function assertVisibleTo(role: Role, curriculum: Curriculum): void {
  if (role === "PARTNER" && curriculum.programType !== "PARTNER_ENABLEMENT") {
    throw notFound("curriculum_not_found");
  }
}

function toObjectiveResult(objective: Objective, scenarioSteps: ScenarioStepResult[] = []): ObjectiveResult {
  return {
    id: objective.id,
    order: objective.order,
    title: objective.title,
    teachingContent: objective.teachingContent,
    checkQuestion: objective.checkQuestion,
    gradingCriteria: objective.gradingCriteria,
    scenarioSteps,
    createdAt: objective.createdAt.toISOString(),
    updatedAt: objective.updatedAt.toISOString(),
  };
}

function toCurriculumResult(
  curriculum: Curriculum,
  objectives: Objective[],
  scenarioStepsByObjectiveId: Map<string, ScenarioStepResult[]> = new Map(),
): CurriculumResult {
  return {
    id: curriculum.id,
    avatarId: curriculum.avatarId,
    title: curriculum.title,
    programType: curriculum.programType,
    adaptiveOrderingEnabled: curriculum.adaptiveOrderingEnabled,
    objectives: [...objectives]
      .sort((a, b) => a.order - b.order)
      .map((o) => toObjectiveResult(o, scenarioStepsByObjectiveId.get(o.id))),
    createdAt: curriculum.createdAt.toISOString(),
    updatedAt: curriculum.updatedAt.toISOString(),
  };
}

/**
 * Shared by getCurriculum/updateCurriculum/replaceObjectives/getCurriculumForAvatar — always
 * called AFTER any writing withOrg block has already committed (never nested inside one; Prisma
 * doesn't support nested transactions), so it's just one extra concurrent-safe read. See
 * .claude/specs/branching-scenario-questions.md.
 */
async function loadScenarioStepsByCurriculumId(
  orgId: string,
  curriculumId: string,
): Promise<Map<string, ScenarioStepResult[]>> {
  const steps = await withOrg(orgId, (tx) =>
    tx.scenarioStep.findMany({
      where: { orgId, objective: { curriculumId } },
      include: { branchesFromHere: { orderBy: { order: "asc" } } },
      orderBy: { order: "asc" },
    }),
  );

  const byObjectiveId = new Map<string, ScenarioStepResult[]>();
  for (const step of steps) {
    const result: ScenarioStepResult = {
      id: step.id,
      order: step.order,
      prompt: step.prompt,
      branches: step.branchesFromHere.map((branch) => ({
        id: branch.id,
        order: branch.order,
        matchCriteria: branch.matchCriteria,
        nextStepId: branch.nextStepId,
        outcome: branch.outcome,
      })),
    };
    const list = byObjectiveId.get(step.objectiveId);
    if (list) list.push(result);
    else byObjectiveId.set(step.objectiveId, [result]);
  }
  return byObjectiveId;
}

export async function createCurriculum(
  orgId: string,
  userId: string,
  input: CreateCurriculumRequest,
): Promise<CreateCurriculumResponse> {
  const avatar = await withOrg(orgId, (tx) => tx.avatar.findFirst({ where: { id: input.avatarId, orgId } }));
  if (!avatar) throw notFound("avatar_not_found");

  try {
    const curriculum = await withOrg(orgId, (tx) =>
      tx.curriculum.create({
        data: {
          orgId,
          avatarId: input.avatarId,
          createdById: userId,
          title: input.title,
          programType: input.programType ?? null,
        },
      }),
    );
    return {
      id: curriculum.id,
      avatarId: curriculum.avatarId,
      title: curriculum.title,
      programType: curriculum.programType,
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) throw conflict("curriculum_exists", "this avatar already has a curriculum");
    throw error;
  }
}

export async function getCurriculum(orgId: string, curriculumId: string, role: Role): Promise<CurriculumResult> {
  const curriculum = await withOrg(orgId, (tx) => tx.curriculum.findFirst({ where: { id: curriculumId, orgId } }));
  if (!curriculum) throw notFound("curriculum_not_found");
  assertVisibleTo(role, curriculum);

  const objectives = await withOrg(orgId, (tx) => tx.objective.findMany({ where: { curriculumId, orgId } }));
  const scenarioStepsByObjectiveId = await loadScenarioStepsByCurriculumId(orgId, curriculumId);
  return toCurriculumResult(curriculum, objectives, scenarioStepsByObjectiveId);
}

export interface CurriculumSummary {
  id: string;
  avatarId: string;
  avatarName: string;
  title: string;
  programType: CurriculumResult["programType"];
  objectiveCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /v1/curricula — org-wide listing, new for
 * .claude/specs/partner-role.md (no such endpoint existed before it; access
 * used to be by id or by avatarId only). OWNER sees every curriculum in the
 * org; PARTNER sees only PARTNER_ENABLEMENT ones — filtered here, in the
 * service layer, never by a client-supplied query param, same
 * "server re-checks entitlement" principle .claude/rules/tenancy.md states
 * for record_progress/grade_answer.
 */
export async function listCurricula(orgId: string, role: Role): Promise<CurriculumSummary[]> {
  return withOrg(orgId, async (tx) => {
    const curricula = await tx.curriculum.findMany({
      where: {
        orgId,
        ...(role === "PARTNER" ? { programType: "PARTNER_ENABLEMENT" } : {}),
      },
      include: { avatar: true, objectives: true },
      orderBy: { createdAt: "desc" },
    });
    return curricula.map((curriculum) => ({
      id: curriculum.id,
      avatarId: curriculum.avatarId,
      avatarName: curriculum.avatar.name ?? "Untitled Avatar",
      title: curriculum.title,
      programType: curriculum.programType,
      objectiveCount: curriculum.objectives.length,
      createdAt: curriculum.createdAt.toISOString(),
      updatedAt: curriculum.updatedAt.toISOString(),
    }));
  });
}

/**
 * PATCH /v1/curricula/:curriculumId — OWNER-only (route-level gate). Partial
 * update, matching knowledge-service.ts's updateDocumentMetadata's
 * `!== undefined` convention: an omitted field is left untouched, an
 * explicit `null` on programType clears it back to uncategorized. See
 * .claude/specs/training-catalog.md.
 */
export async function updateCurriculum(
  orgId: string,
  curriculumId: string,
  patch: UpdateCurriculumRequest,
): Promise<CurriculumResult> {
  const { updated, objectives } = await withOrg(orgId, async (tx) => {
    const existing = await tx.curriculum.findFirst({ where: { id: curriculumId, orgId } });
    if (!existing) throw notFound("curriculum_not_found");

    const updated = await tx.curriculum.update({
      where: { id: curriculumId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.programType !== undefined ? { programType: patch.programType } : {}),
        ...(patch.adaptiveOrderingEnabled !== undefined
          ? { adaptiveOrderingEnabled: patch.adaptiveOrderingEnabled }
          : {}),
      },
    });
    const objectives = await tx.objective.findMany({ where: { curriculumId, orgId } });
    return { updated, objectives };
  });
  const scenarioStepsByObjectiveId = await loadScenarioStepsByCurriculumId(orgId, curriculumId);
  return toCurriculumResult(updated, objectives, scenarioStepsByObjectiveId);
}

export async function deleteCurriculum(orgId: string, curriculumId: string): Promise<void> {
  const curriculum = await withOrg(orgId, (tx) => tx.curriculum.findFirst({ where: { id: curriculumId, orgId } }));
  if (!curriculum) throw notFound("curriculum_not_found");

  // Objective and ObjectiveProgress rows cascade via their FKs' ON DELETE
  // CASCADE — see prisma/migrations/*_add_interactive_assessment.
  await withOrg(orgId, (tx) => tx.curriculum.delete({ where: { id: curriculumId } }));
}

/**
 * Replace-the-whole-list semantics (see
 * .claude/specs/interactive-assessment.md's API Changes): objectives with an
 * `id` are updated in place (preserving the id any ObjectiveProgress rows
 * already reference — deleting and recreating on every save would silently
 * orphan a learner's recorded progress on every edit), objectives without
 * one are created, and existing objectives missing from the new list are
 * deleted. Array position becomes the new `order`.
 *
 * Objective has a @@unique([curriculumId, order]) constraint checked
 * per-statement (not deferred), so writing straight to each row's final
 * array-index order can collide mid-transaction with another row that
 * still holds that order (e.g. two objectives swapping places). Every
 * surviving existing row is first staged through a negative,
 * collision-free order, then all rows (existing and new) get their final
 * order in a second pass — this is DB-constraint correctness, not
 * speculative design.
 */
export async function replaceObjectives(
  orgId: string,
  curriculumId: string,
  objectives: ObjectiveInput[],
): Promise<ObjectiveResult[]> {
  const saved = await withOrg(orgId, async (tx) => {
    const curriculum = await tx.curriculum.findFirst({ where: { id: curriculumId, orgId } });
    if (!curriculum) throw notFound("curriculum_not_found");

    const existing = await tx.objective.findMany({ where: { curriculumId, orgId } });
    const existingIds = new Set(existing.map((o) => o.id));
    const incomingIds = new Set(objectives.flatMap((o) => (o.id ? [o.id] : [])));

    for (const objective of objectives) {
      if (objective.id && !existingIds.has(objective.id)) {
        throw badRequest("objective_not_found", `objective ${objective.id} does not belong to this curriculum`);
      }
    }

    const toDelete = existing.filter((o) => !incomingIds.has(o.id));
    if (toDelete.length > 0) {
      await tx.objective.deleteMany({ where: { id: { in: toDelete.map((o) => o.id) } } });
    }

    const survivingExisting = existing.filter((o) => incomingIds.has(o.id));
    for (let i = 0; i < survivingExisting.length; i++) {
      await tx.objective.update({ where: { id: survivingExisting[i]!.id }, data: { order: -(i + 1) } });
    }

    const saved: Objective[] = [];
    for (let index = 0; index < objectives.length; index++) {
      const input = objectives[index]!;
      const data = {
        order: index,
        title: input.title,
        teachingContent: input.teachingContent,
        checkQuestion: input.checkQuestion,
        gradingCriteria: input.gradingCriteria,
      };
      saved.push(
        input.id
          ? await tx.objective.update({ where: { id: input.id }, data })
          : await tx.objective.create({ data: { ...data, orgId, curriculumId } }),
      );
    }

    return saved.sort((a, b) => a.order - b.order);
  });
  const scenarioStepsByObjectiveId = await loadScenarioStepsByCurriculumId(orgId, curriculumId);
  return saved.map((o) => toObjectiveResult(o, scenarioStepsByObjectiveId.get(o.id)));
}

export interface SessionCurriculumObjective {
  id: string;
  title: string;
  teachingContent: string;
  checkQuestion: string;
  gradingCriteria: string;
  // Empty = flat checkQuestion/gradingCriteria path; non-empty = branching scenario, see
  // .claude/specs/branching-scenario-questions.md. Reuses the API result type directly for
  // session runtime state — no parallel type needed.
  scenarioSteps: ScenarioStepResult[];
  status: ObjectiveMasteryStatus;
  lastFeedback?: string;
  attempts?: number;
}

export interface SessionCurriculum {
  curriculumId: string;
  objectives: SessionCurriculumObjective[];
}

/**
 * Sort weight for getCurriculumForAvatar's mastery-based reweighting, used only when the
 * curriculum's adaptiveOrderingEnabled is true. Array.prototype.sort is stable, so objectives
 * sharing a tier keep their authored relative order — this reweights the existing sequence
 * rather than replacing it. See .claude/specs/adaptive-learning-paths.md.
 */
const MASTERY_TIER: Record<ObjectiveMasteryStatus, number> = {
  NEEDS_REVIEW: 0,
  NOT_STARTED: 1,
  MASTERED: 2,
};

/**
 * Internal lookup for conversation-service.ts's session.start handler — not
 * a REST endpoint (no notFound/404: a missing curriculum is a normal,
 * silent "teach without checkpoints" case, not an error). Returns null
 * rather than a curriculum with zero objectives, so callers can use a
 * single truthiness check.
 *
 * learnerId: string looks up THAT learner's own ObjectiveProgress rows
 * (@@unique([objectiveId, learnerId]) guarantees at most one per objective)
 * to compute a mastery status — see
 * .claude/specs/adaptive-learning-personalization.md. learnerId: null
 * (anonymous/embed sessions, which per .claude/rules/tenancy.md never have
 * ObjectiveProgress rows to begin with) skips the progress query entirely
 * and returns every objective NOT_STARTED — today's behavior, unchanged.
 *
 * When curriculum.adaptiveOrderingEnabled is set, the returned objectives are additionally
 * reweighted by mastery tier (NEEDS_REVIEW, then NOT_STARTED, then MASTERED) rather than left in
 * strict authored order — see .claude/specs/adaptive-learning-paths.md. Off by default, so an
 * unset curriculum returns objectives in authored order exactly as before this field existed.
 */
export async function getCurriculumForAvatar(
  orgId: string,
  avatarId: string,
  learnerId: string | null,
): Promise<SessionCurriculum | null> {
  const curriculum = await withOrg(orgId, (tx) => tx.curriculum.findFirst({ where: { avatarId, orgId } }));
  if (!curriculum) return null;

  // Independent queries (progress doesn't depend on the objectives result, only on
  // curriculum.id) — run concurrently rather than sequentially to keep this bootstrap
  // lookup's added cost to one round trip, not two. See
  // .claude/specs/adaptive-learning-personalization.md; latency-auditor flagged the
  // sequential version as an avoidable extra round trip inside session.start's budget.
  const [objectives, progressRows, scenarioStepsByObjectiveId] = await Promise.all([
    withOrg(orgId, (tx) =>
      tx.objective.findMany({ where: { curriculumId: curriculum.id, orgId }, orderBy: { order: "asc" } }),
    ),
    learnerId
      ? withOrg(orgId, (tx) =>
          tx.objectiveProgress.findMany({ where: { orgId, learnerId, objective: { curriculumId: curriculum.id } } }),
        )
      : Promise.resolve([]),
    loadScenarioStepsByCurriculumId(orgId, curriculum.id),
  ]);
  if (objectives.length === 0) return null;

  const progressByObjectiveId = new Map<
    string,
    { verdict: ObjectiveProgressVerdict; feedback: string; attempts: number }
  >();
  for (const row of progressRows) progressByObjectiveId.set(row.objectiveId, row);

  const annotatedObjectives = objectives.map((o) => {
    const progress = progressByObjectiveId.get(o.id);
    const status: ObjectiveMasteryStatus = !progress
      ? "NOT_STARTED"
      : progress.verdict === "PASS"
        ? "MASTERED"
        : "NEEDS_REVIEW";
    return {
      id: o.id,
      title: o.title,
      teachingContent: o.teachingContent,
      checkQuestion: o.checkQuestion,
      gradingCriteria: o.gradingCriteria,
      scenarioSteps: scenarioStepsByObjectiveId.get(o.id) ?? [],
      status,
      ...(status === "NEEDS_REVIEW" ? { lastFeedback: progress!.feedback, attempts: progress!.attempts } : {}),
      ...(status === "MASTERED" ? { attempts: progress!.attempts } : {}),
    };
  });

  return {
    curriculumId: curriculum.id,
    objectives: curriculum.adaptiveOrderingEnabled
      ? [...annotatedObjectives].sort((a, b) => MASTERY_TIER[a.status] - MASTERY_TIER[b.status])
      : annotatedObjectives,
  };
}

/**
 * record_progress's persistence — serverOnly per .claude/rules/tenancy.md.
 * Only ever called from conversation-service.ts's tool dispatcher with a
 * verdict IT computed via grade_answer, never with a value read from the
 * model's tool-call arguments. One row per (objective, learner); attempts
 * increments on every call rather than being set explicitly, so a caller
 * can't understate a learner's real attempt count.
 */
export async function recordObjectiveProgress(
  orgId: string,
  objectiveId: string,
  learnerId: string,
  verdict: ObjectiveProgressVerdict,
  feedback: string,
): Promise<{ attempts: number }> {
  const result = await withOrg(orgId, (tx) =>
    tx.objectiveProgress.upsert({
      where: { objectiveId_learnerId: { objectiveId, learnerId } },
      create: { orgId, objectiveId, learnerId, verdict, feedback, attempts: 1 },
      update: { verdict, feedback, attempts: { increment: 1 } },
    }),
  );
  return { attempts: result.attempts };
}

/** end_module's completion check — titles of objectives this learner has not yet PASSed. */
export async function getRemainingObjectiveTitles(
  orgId: string,
  curriculumId: string,
  learnerId: string,
): Promise<string[]> {
  const objectives = await withOrg(orgId, (tx) =>
    tx.objective.findMany({
      where: { curriculumId, orgId },
      include: { progress: { where: { learnerId } } },
      orderBy: { order: "asc" },
    }),
  );
  return objectives.filter((o) => !o.progress.some((p) => p.verdict === "PASS")).map((o) => o.title);
}

export async function listCurriculumProgress(
  orgId: string,
  curriculumId: string,
  role: Role,
): Promise<ObjectiveProgressEntry[]> {
  const curriculum = await withOrg(orgId, (tx) => tx.curriculum.findFirst({ where: { id: curriculumId, orgId } }));
  if (!curriculum) throw notFound("curriculum_not_found");
  assertVisibleTo(role, curriculum);

  const rows = await withOrg(orgId, (tx) =>
    tx.objectiveProgress.findMany({
      where: { orgId, objective: { curriculumId } },
      include: { objective: true, learner: true },
      orderBy: { updatedAt: "desc" },
    }),
  );

  return rows.map((row) => ({
    objectiveId: row.objectiveId,
    objectiveTitle: row.objective.title,
    learnerId: row.learnerId,
    learnerEmail: row.learner.email,
    verdict: row.verdict,
    attempts: row.attempts,
    feedback: row.feedback,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function timeToCompetencySeconds(row: { createdAt: Date; updatedAt: Date }): number {
  return (row.updatedAt.getTime() - row.createdAt.getTime()) / 1000;
}

/**
 * Aggregates the same rows listCurriculumProgress returns raw into
 * completion rate, per-objective mastery trend, and time-to-competency. See
 * .claude/specs/training-effectiveness-measurement.md. Known limitation
 * (deliberately not solved with new schema): a re-graded PASS moves
 * updatedAt to the newer pass, so time-to-competency measures
 * time-to-most-recent-pass, not time-to-first-pass.
 */
export async function getCurriculumEffectiveness(
  orgId: string,
  curriculumId: string,
  role: Role,
): Promise<CurriculumEffectiveness> {
  const curriculum = await withOrg(orgId, (tx) => tx.curriculum.findFirst({ where: { id: curriculumId, orgId } }));
  if (!curriculum) throw notFound("curriculum_not_found");
  assertVisibleTo(role, curriculum);

  const objectives = await withOrg(orgId, (tx) =>
    tx.objective.findMany({ where: { curriculumId, orgId }, orderBy: { order: "asc" } }),
  );
  const rows = await withOrg(orgId, (tx) =>
    tx.objectiveProgress.findMany({ where: { orgId, objective: { curriculumId } } }),
  );

  const rowsByObjective = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = rowsByObjective.get(row.objectiveId);
    if (existing) existing.push(row);
    else rowsByObjective.set(row.objectiveId, [row]);
  }

  const objectiveStats: ObjectiveEffectiveness[] = objectives.map((objective) => {
    const objectiveRows = rowsByObjective.get(objective.id) ?? [];
    const passRows = objectiveRows.filter((row) => row.verdict === "PASS");
    const attemptedLearnerCount = objectiveRows.length;
    const passedLearnerCount = passRows.length;
    return {
      objectiveId: objective.id,
      objectiveTitle: objective.title,
      order: objective.order,
      attemptedLearnerCount,
      passedLearnerCount,
      passRate: attemptedLearnerCount > 0 ? passedLearnerCount / attemptedLearnerCount : 0,
      avgAttemptsToPass: average(passRows.map((row) => row.attempts)),
      avgTimeToCompetencySeconds: average(passRows.map(timeToCompetencySeconds)),
    };
  });

  const learnerIds = new Set(rows.map((row) => row.learnerId));
  const passedObjectiveIdsByLearner = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.verdict !== "PASS") continue;
    const existing = passedObjectiveIdsByLearner.get(row.learnerId);
    if (existing) existing.add(row.objectiveId);
    else passedObjectiveIdsByLearner.set(row.learnerId, new Set([row.objectiveId]));
  }
  // objectives.length > 0 guard: a curriculum with no objectives must never
  // vacuously count every learner as "completed."
  const completedLearnerCount =
    objectives.length === 0
      ? 0
      : [...learnerIds].filter((learnerId) => passedObjectiveIdsByLearner.get(learnerId)?.size === objectives.length)
          .length;
  const learnerCount = learnerIds.size;

  return {
    curriculumId,
    learnerCount,
    completedLearnerCount,
    completionRate: learnerCount > 0 ? completedLearnerCount / learnerCount : 0,
    avgTimeToCompetencySeconds: average(rows.filter((row) => row.verdict === "PASS").map(timeToCompetencySeconds)),
    objectives: objectiveStats,
  };
}
