import {
  redact,
  withOrg,
  type KnowledgeArea,
  type PerformanceAnalyticsResponse,
  type RatingDistributionPoint,
  type SatisfactionAnalyticsResponse,
  type TrainingAnalyticsResponse,
  type UsageAnalyticsResponse,
} from "@avatrain/shared";

const DEFAULT_WINDOW_DAYS = 30;
const TOP_KNOWLEDGE_AREAS_LIMIT = 10;
const MIN_ATTEMPTS = 2;
const KNOWLEDGE_GAPS_LIMIT = 10;
// Fixed window for knowledgeUtilizationTrend, independent of the days query param — see
// getPerformanceAnalytics's doc comment and .claude/specs/ai-performance-analytics.md's Database
// Changes for why this is bounded, indexed count() calls rather than a groupBy.
const TREND_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function windowStart(windowDays: number): Date {
  return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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

export interface TurnMetricInput {
  turnId: string;
  sttMs?: number;
  retrievalMs?: number;
  llmFirstTokenMs?: number;
  ttsFirstChunkMs?: number;
  totalMs: number;
  grounded: boolean;
}

/**
 * Fire-and-forget from conversation-service.ts's turn-completion path (never awaited, never
 * throws into the caller — same posture as recordKnowledgeAccess above, for the same
 * .claude/rules/realtime.md "never block the audio path" reason). Unlike
 * persistTrainingSessionMessage, does NOT no-op when trainingSessionId is null — an anonymous
 * apps/widget embed session's turn is exactly the real usage this table exists to capture. See
 * .claude/specs/ai-performance-analytics.md's Realtime Changes.
 */
export async function recordTurnMetric(
  orgId: string,
  trainingSessionId: string | null,
  metric: TurnMetricInput,
): Promise<void> {
  try {
    await withOrg(orgId, (tx) =>
      tx.turnMetric.create({
        data: {
          orgId,
          trainingSessionId,
          turnId: metric.turnId,
          sttMs: metric.sttMs ?? null,
          retrievalMs: metric.retrievalMs ?? null,
          llmFirstTokenMs: metric.llmFirstTokenMs ?? null,
          ttsFirstChunkMs: metric.ttsFirstChunkMs ?? null,
          totalMs: metric.totalMs,
          grounded: metric.grounded,
        },
      }),
    );
  } catch (error) {
    console.error("recordTurnMetric failed", { orgId, turnId: metric.turnId }, error);
  }
}

/**
 * GET /v1/analytics/performance — see .claude/specs/ai-performance-analytics.md. turnCount,
 * avgLatencyMs, and groundedReplyRate use Prisma's native count/aggregate (not a full-row fetch),
 * the same "TurnMetric volume is unbounded like KnowledgeAccessEvent" reasoning
 * getUsageAnalytics's topKnowledgeAreas already established — `_avg` ignores null hop values
 * automatically (a turn that skipped a hop, e.g. no retrieval call made), which is exactly the
 * wanted behavior with no manual null-filtering.
 *
 * knowledgeUtilizationTrend buckets KnowledgeAccessEvent by day over a FIXED TREND_DAYS window,
 * independent of the `days` selector above: Prisma's groupBy cannot express a
 * date_trunc('day', ...) grouping without raw SQL, so this issues TREND_DAYS bounded, indexed
 * (org_id, created_at) count() calls instead — small and constant-cost regardless of org size.
 * Every field this function returns is real, org-wide production data (unlike
 * getUsageAnalytics's TrainingSession-derived fields): the turn pipeline runs identically for
 * dashboard rehearsal and the public apps/widget embed. groundedReplyRate is NOT a
 * factual-accuracy judgment — see the spec's Overview.
 */
export async function getPerformanceAnalytics(
  orgId: string,
  windowDays: 7 | 30 | 90 = DEFAULT_WINDOW_DAYS,
): Promise<PerformanceAnalyticsResponse> {
  const cutoff = windowStart(windowDays);
  const turnWhere = { orgId, createdAt: { gte: cutoff } };
  const todayUtc = startOfUtcDay(new Date());

  const [turnCount, groundedCount, latencyAgg, knowledgeUtilizationTrend] = await withOrg(orgId, (tx) =>
    Promise.all([
      tx.turnMetric.count({ where: turnWhere }),
      tx.turnMetric.count({ where: { ...turnWhere, grounded: true } }),
      tx.turnMetric.aggregate({
        where: turnWhere,
        _avg: { sttMs: true, retrievalMs: true, llmFirstTokenMs: true, ttsFirstChunkMs: true, totalMs: true },
      }),
      Promise.all(
        Array.from({ length: TREND_DAYS }, (_, i) => {
          const dayStart = new Date(todayUtc.getTime() - (TREND_DAYS - 1 - i) * DAY_MS);
          const dayEnd = new Date(dayStart.getTime() + DAY_MS);
          return tx.knowledgeAccessEvent
            .count({ where: { orgId, createdAt: { gte: dayStart, lt: dayEnd } } })
            .then((accessCount) => ({ date: dayStart.toISOString().slice(0, 10), accessCount }));
        }),
      ),
    ]),
  );

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    turnCount,
    avgLatencyMs: {
      stt: latencyAgg._avg.sttMs,
      retrieval: latencyAgg._avg.retrievalMs,
      llmFirstToken: latencyAgg._avg.llmFirstTokenMs,
      ttsFirstChunk: latencyAgg._avg.ttsFirstChunkMs,
      total: latencyAgg._avg.totalMs,
    },
    groundedReplyRate: turnCount === 0 ? null : groundedCount / turnCount,
    knowledgeUtilizationTrend,
  };
}

/**
 * Fire-and-forget from conversation-service.ts's new "session.rate" WS message handler — see
 * .claude/specs/user-satisfaction.md. Same try/catch-and-log-only posture as recordTurnMetric:
 * never awaited by the caller, never throws. Unlike recordTurnMetric this is client-initiated
 * (a learner's own submission), not a server-computed pipeline event, but the nullable-
 * trainingSessionId/never-no-op posture is identical — an anonymous apps/widget embed session's
 * rating is exactly the real usage this table exists to capture. `comment` is passed through
 * redact() before insert, same convention as Message.content (.claude/rules/tenancy.md: "Redact
 * PII before insert, never on read").
 */
export async function recordSatisfactionRating(
  orgId: string,
  trainingSessionId: string | null,
  rating: number,
  comment: string | null,
): Promise<void> {
  try {
    await withOrg(orgId, (tx) =>
      tx.satisfactionRating.create({
        data: { orgId, trainingSessionId, rating, comment: comment ? redact(comment) : null },
      }),
    );
  } catch (error) {
    console.error("recordSatisfactionRating failed", { orgId }, error);
  }
}

const RATING_VALUES = [1, 2, 3, 4, 5] as const;

/**
 * GET /v1/analytics/satisfaction — see .claude/specs/user-satisfaction.md. Uses Prisma's native
 * groupBy on the `rating` Int column for the distribution (no raw SQL needed, unlike
 * knowledgeUtilizationTrend's per-day bucketing above) — zero-filled for any rating value with no
 * rows in the window, never omitted, same convention knowledgeUtilizationTrend's doc comment
 * established. Every row this aggregates today comes from the public apps/widget embed (no
 * dashboard rehearsal surface sends session.rate — see the spec's Overview), so this is real,
 * org-wide data like getPerformanceAnalytics's fields, unlike getUsageAnalytics's/
 * getTrainingAnalytics's TrainingSession/ObjectiveProgress-derived fields.
 */
export async function getSatisfactionAnalytics(
  orgId: string,
  windowDays: 7 | 30 | 90 = DEFAULT_WINDOW_DAYS,
): Promise<SatisfactionAnalyticsResponse> {
  const cutoff = windowStart(windowDays);
  const where = { orgId, createdAt: { gte: cutoff } };

  const [aggregate, grouped] = await withOrg(orgId, (tx) =>
    Promise.all([
      tx.satisfactionRating.aggregate({ where, _avg: { rating: true }, _count: true }),
      tx.satisfactionRating.groupBy({ by: ["rating"], where, _count: true }),
    ]),
  );

  const countByRating = new Map(grouped.map((row) => [row.rating, row._count]));
  const ratingDistribution: RatingDistributionPoint[] = RATING_VALUES.map((rating) => ({
    rating,
    count: countByRating.get(rating) ?? 0,
  }));

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    ratingCount: aggregate._count,
    avgRating: aggregate._count === 0 ? null : aggregate._avg.rating,
    ratingDistribution,
  };
}
