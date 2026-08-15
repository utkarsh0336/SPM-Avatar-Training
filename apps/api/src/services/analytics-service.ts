import {
  withOrg,
  type KnowledgeArea,
  type TrainingAnalyticsResponse,
  type UsageAnalyticsResponse,
} from "@avatrain/shared";

const DEFAULT_WINDOW_DAYS = 30;
const TOP_KNOWLEDGE_AREAS_LIMIT = 10;
const MIN_ATTEMPTS = 2;
const KNOWLEDGE_GAPS_LIMIT = 10;

function windowStart(windowDays: number): Date {
  return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Duplicated from curriculum-service.ts's private helper of the same name/body — that one isn't
// exported, and average() above is already independently duplicated between the two files, so
// this follows the existing convention rather than introducing a new shared module for one line.
function timeToCompetencySeconds(row: { createdAt: Date; updatedAt: Date }): number {
  return (row.updatedAt.getTime() - row.createdAt.getTime()) / 1000;
}

/**
 * Fire-and-forget from conversation-service.ts's retrieval path (never awaited, never throws into
 * the caller — same posture as training-session-service.ts's persistTrainingSessionMessage, for
 * the same .claude/rules/realtime.md "never block the audio path" reason). Unlike
 * persistTrainingSessionMessage, does NOT no-op when trainingSessionId is null — an anonymous
 * apps/widget embed session's retrieval is exactly the real usage this table exists to capture.
 * See .claude/specs/dashboard-analytics.md's Realtime Changes.
 */
export async function recordKnowledgeAccess(
  orgId: string,
  documentId: string,
  trainingSessionId: string | null,
): Promise<void> {
  try {
    await withOrg(orgId, (tx) =>
      tx.knowledgeAccessEvent.create({ data: { orgId, documentId, trainingSessionId } }),
    );
  } catch (error) {
    console.error("recordKnowledgeAccess failed", { orgId, documentId }, error);
  }
}

/**
 * GET /v1/analytics/usage. activeUserCount/totalConversationCount/avgSessionDurationSeconds are
 * computed from TrainingSession, which only the dashboard's own rehearsal surfaces ever write —
 * see dashboard-analytics.md's Overview for why these three measure trainer rehearsal activity,
 * not production embed traffic. That fetch-and-reduce-in-JS approach matches
 * training-effectiveness-measurement.md's existing convention and stays within its safe bound (a
 * dashboard's own rehearsal session count, not open-ended event volume).
 *
 * topKnowledgeAreas uses Prisma's groupBy instead — a deliberate departure from that same
 * convention, because KnowledgeAccessEvent volume is not bounded the same way (see
 * dashboard-analytics.md's Database Changes "Aggregation approach" note and
 * docs/ARCHITECTURE.md §5's dashboard-aggregation-cost warning).
 */
export async function getUsageAnalytics(
  orgId: string,
  windowDays: 7 | 30 | 90 = DEFAULT_WINDOW_DAYS,
): Promise<UsageAnalyticsResponse> {
  const cutoff = windowStart(windowDays);

  const sessions = await withOrg(orgId, (tx) =>
    tx.trainingSession.findMany({
      where: { orgId, createdAt: { gte: cutoff } },
      select: { createdByUserId: true, status: true, createdAt: true, endedAt: true },
    }),
  );

  const activeUserCount = new Set(sessions.map((session) => session.createdByUserId)).size;
  const totalConversationCount = sessions.length;
  const avgSessionDurationSeconds = average(
    sessions
      .filter((session): session is typeof session & { endedAt: Date } => session.status === "ENDED" && session.endedAt !== null)
      .map((session) => (session.endedAt.getTime() - session.createdAt.getTime()) / 1000),
  );

  const grouped = await withOrg(orgId, (tx) =>
    tx.knowledgeAccessEvent.groupBy({
      by: ["documentId"],
      where: { orgId, createdAt: { gte: cutoff } },
      _count: { _all: true },
      orderBy: { _count: { documentId: "desc" } },
      take: TOP_KNOWLEDGE_AREAS_LIMIT,
    }),
  );

  const documents =
    grouped.length === 0
      ? []
      : await withOrg(orgId, (tx) =>
          tx.knowledgeDocument.findMany({
            where: { orgId, id: { in: grouped.map((row) => row.documentId) } },
            select: { id: true, title: true, category: true },
          }),
        );
  const documentsById = new Map(documents.map((document) => [document.id, document]));

  const topKnowledgeAreas: KnowledgeArea[] = grouped
    .map((row) => {
      const document = documentsById.get(row.documentId);
      // A document deleted after its access events were recorded — the events cascade-delete with
      // it (onDelete: Cascade), so this branch is unreachable in practice; guarded anyway rather
      // than trusting that invariant to hold forever.
      if (!document) return null;
      return {
        documentId: row.documentId,
        documentTitle: document.title,
        category: document.category,
        accessCount: row._count._all,
      };
    })
    .filter((area): area is KnowledgeArea => area !== null);

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    activeUserCount,
    totalConversationCount,
    avgSessionDurationSeconds,
    topKnowledgeAreas,
  };
}

/**
 * GET /v1/analytics/training — see .claude/specs/training-analytics.md. Org-wide rollup of the
 * same ObjectiveProgress rows getCurriculumEffectiveness (curriculum-service.ts) aggregates
 * per-curriculum, grouped differently: across every curriculum in the org, not within one.
 * Deliberately mirrors that function's fetch-and-reduce-in-JS approach, NOT Prisma's groupBy,
 * because ObjectiveProgress is bounded by (org's objective count) × (org's rehearsing-staff
 * count) — the same safe bound getCurriculumEffectiveness relies on. Contrast topKnowledgeAreas
 * above, which uses groupBy specifically because KnowledgeAccessEvent volume is NOT bounded that
 * way.
 *
 * avgCompletionRate is the mean of PER-CURRICULUM completion rate (a learner counts as
 * "completed" only once they've passed every objective CURRENTLY in that curriculum — including
 * one nobody has attempted yet, hence the separate `objectives` fetch below, not just the ones
 * inferrable from progress rows), averaged across curricula with >=1 ObjectiveProgress row; a
 * curriculum nobody has touched is excluded entirely rather than pulling the average toward 0.
 * avgTimeToCompetencySeconds is a flat mean across every PASS row org-wide (no per-curriculum
 * averaging).
 */
export async function getTrainingAnalytics(orgId: string): Promise<TrainingAnalyticsResponse> {
  const objectives = await withOrg(orgId, (tx) =>
    tx.objective.findMany({ where: { orgId }, select: { id: true, curriculumId: true } }),
  );
  const rows = await withOrg(orgId, (tx) =>
    tx.objectiveProgress.findMany({
      where: { orgId },
      include: { objective: { include: { curriculum: true } } },
    }),
  );

  const participantCount = new Set(rows.map((row) => row.learnerId)).size;

  const objectiveIdsByCurriculum = new Map<string, Set<string>>();
  for (const objective of objectives) {
    const existing = objectiveIdsByCurriculum.get(objective.curriculumId);
    if (existing) existing.add(objective.id);
    else objectiveIdsByCurriculum.set(objective.curriculumId, new Set([objective.id]));
  }

  const rowsByCurriculum = new Map<string, typeof rows>();
  for (const row of rows) {
    const curriculumId = row.objective.curriculumId;
    const existing = rowsByCurriculum.get(curriculumId);
    if (existing) existing.push(row);
    else rowsByCurriculum.set(curriculumId, [row]);
  }
  const curriculumsWithActivityCount = rowsByCurriculum.size;

  const perCurriculumCompletionRates: number[] = [];
  for (const [curriculumId, curriculumRows] of rowsByCurriculum) {
    const curriculumObjectiveIds = objectiveIdsByCurriculum.get(curriculumId) ?? new Set<string>();
    const learnerIds = new Set(curriculumRows.map((row) => row.learnerId));
    const passedObjectiveIdsByLearner = new Map<string, Set<string>>();
    for (const row of curriculumRows) {
      if (row.verdict !== "PASS") continue;
      const existing = passedObjectiveIdsByLearner.get(row.learnerId);
      if (existing) existing.add(row.objectiveId);
      else passedObjectiveIdsByLearner.set(row.learnerId, new Set([row.objectiveId]));
    }
    // curriculumObjectiveIds.size === 0 guard mirrors getCurriculumEffectiveness's — a curriculum
    // with no current objectives must never vacuously count every learner as "completed." In
    // practice unreachable here (Objective's onDelete: Cascade means a 0-objective curriculum has
    // no ObjectiveProgress rows left to enter rowsByCurriculum), kept defensively anyway.
    const completedLearnerCount =
      curriculumObjectiveIds.size === 0
        ? 0
        : [...learnerIds].filter(
            (learnerId) => passedObjectiveIdsByLearner.get(learnerId)?.size === curriculumObjectiveIds.size,
          ).length;
    perCurriculumCompletionRates.push(learnerIds.size > 0 ? completedLearnerCount / learnerIds.size : 0);
  }
  const avgCompletionRate = average(perCurriculumCompletionRates);

  const avgTimeToCompetencySeconds = average(
    rows.filter((row) => row.verdict === "PASS").map(timeToCompetencySeconds),
  );

  const rowsByObjective = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = rowsByObjective.get(row.objectiveId);
    if (existing) existing.push(row);
    else rowsByObjective.set(row.objectiveId, [row]);
  }

  const knowledgeGaps = [...rowsByObjective.entries()]
    .map(([objectiveId, objectiveRows]) => {
      const attemptedLearnerCount = objectiveRows.length;
      const passedLearnerCount = objectiveRows.filter((row) => row.verdict === "PASS").length;
      const sample = objectiveRows[0]!;
      return {
        objectiveId,
        objectiveTitle: sample.objective.title,
        curriculumId: sample.objective.curriculumId,
        curriculumTitle: sample.objective.curriculum.title,
        attemptedLearnerCount,
        passRate: passedLearnerCount / attemptedLearnerCount,
      };
    })
    .filter((gap) => gap.attemptedLearnerCount >= MIN_ATTEMPTS)
    .sort((a, b) => a.passRate - b.passRate)
    .slice(0, KNOWLEDGE_GAPS_LIMIT);

  return {
    generatedAt: new Date().toISOString(),
    participantCount,
    curriculumsWithActivityCount,
    avgCompletionRate,
    avgTimeToCompetencySeconds,
    knowledgeGaps,
  };
}
