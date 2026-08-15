import { withOrg, type KnowledgeArea, type UsageAnalyticsResponse } from "@avatrain/shared";

const DEFAULT_WINDOW_DAYS = 30;
const TOP_KNOWLEDGE_AREAS_LIMIT = 10;

function windowStart(windowDays: number): Date {
  return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
