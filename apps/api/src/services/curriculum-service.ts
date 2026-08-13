import {
  isUniqueConstraintError,
  withOrg,
  type CreateCurriculumRequest,
  type CreateCurriculumResponse,
  type CurriculumResult,
  type ObjectiveInput,
  type ObjectiveMasteryStatus,
  type ObjectiveProgressEntry,
  type ObjectiveProgressVerdict,
  type ObjectiveResult,
} from "@avatrain/shared";
import type { Curriculum, Objective } from "@prisma/client";
import { badRequest, conflict, notFound } from "../lib/http-errors.js";

function toObjectiveResult(objective: Objective): ObjectiveResult {
  return {
    id: objective.id,
    order: objective.order,
    title: objective.title,
    teachingContent: objective.teachingContent,
    checkQuestion: objective.checkQuestion,
    gradingCriteria: objective.gradingCriteria,
    createdAt: objective.createdAt.toISOString(),
    updatedAt: objective.updatedAt.toISOString(),
  };
}

function toCurriculumResult(curriculum: Curriculum, objectives: Objective[]): CurriculumResult {
  return {
    id: curriculum.id,
    avatarId: curriculum.avatarId,
    title: curriculum.title,
    objectives: [...objectives].sort((a, b) => a.order - b.order).map(toObjectiveResult),
    createdAt: curriculum.createdAt.toISOString(),
    updatedAt: curriculum.updatedAt.toISOString(),
  };
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
        data: { orgId, avatarId: input.avatarId, createdById: userId, title: input.title },
      }),
    );
    return { id: curriculum.id, avatarId: curriculum.avatarId, title: curriculum.title };
  } catch (error) {
    if (isUniqueConstraintError(error)) throw conflict("curriculum_exists", "this avatar already has a curriculum");
    throw error;
  }
}

export async function getCurriculum(orgId: string, curriculumId: string): Promise<CurriculumResult> {
  const curriculum = await withOrg(orgId, (tx) => tx.curriculum.findFirst({ where: { id: curriculumId, orgId } }));
  if (!curriculum) throw notFound("curriculum_not_found");

  const objectives = await withOrg(orgId, (tx) => tx.objective.findMany({ where: { curriculumId, orgId } }));
  return toCurriculumResult(curriculum, objectives);
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
  return withOrg(orgId, async (tx) => {
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

    return saved.sort((a, b) => a.order - b.order).map(toObjectiveResult);
  });
}

export interface SessionCurriculumObjective {
  id: string;
  title: string;
  teachingContent: string;
  checkQuestion: string;
  gradingCriteria: string;
  status: ObjectiveMasteryStatus;
  lastFeedback?: string;
  attempts?: number;
}

export interface SessionCurriculum {
  curriculumId: string;
  objectives: SessionCurriculumObjective[];
}

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
  const [objectives, progressRows] = await Promise.all([
    withOrg(orgId, (tx) =>
      tx.objective.findMany({ where: { curriculumId: curriculum.id, orgId }, orderBy: { order: "asc" } }),
    ),
    learnerId
      ? withOrg(orgId, (tx) =>
          tx.objectiveProgress.findMany({ where: { orgId, learnerId, objective: { curriculumId: curriculum.id } } }),
        )
      : Promise.resolve([]),
  ]);
  if (objectives.length === 0) return null;

  const progressByObjectiveId = new Map<
    string,
    { verdict: ObjectiveProgressVerdict; feedback: string; attempts: number }
  >();
  for (const row of progressRows) progressByObjectiveId.set(row.objectiveId, row);

  return {
    curriculumId: curriculum.id,
    objectives: objectives.map((o) => {
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
        status,
        ...(status === "NEEDS_REVIEW" ? { lastFeedback: progress!.feedback, attempts: progress!.attempts } : {}),
        ...(status === "MASTERED" ? { attempts: progress!.attempts } : {}),
      };
    }),
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

export async function listCurriculumProgress(orgId: string, curriculumId: string): Promise<ObjectiveProgressEntry[]> {
  const curriculum = await withOrg(orgId, (tx) => tx.curriculum.findFirst({ where: { id: curriculumId, orgId } }));
  if (!curriculum) throw notFound("curriculum_not_found");

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
