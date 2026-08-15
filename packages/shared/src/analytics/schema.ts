import { z } from "zod";

// GET /v1/analytics/usage — see .claude/specs/dashboard-analytics.md. A closed set of windows
// (querystring values arrive as strings, transformed to their numeric literal), not a free
// integer, so a caller can't request an unindexed full-range scan.
export const usageAnalyticsQuerySchema = z.object({
  days: z
    .union([z.literal("7"), z.literal("30"), z.literal("90")])
    .transform((value) => Number(value) as 7 | 30 | 90)
    .optional(),
});
export type UsageAnalyticsQuery = z.infer<typeof usageAnalyticsQuerySchema>;

// One row per document with >=1 KnowledgeAccessEvent in the window, ranked by accessCount desc,
// capped at 10. Org-wide and real — retrieval runs on both the dashboard-rehearsal and anonymous
// apps/widget embed paths, unlike the TrainingSession-derived fields below.
export const knowledgeAreaSchema = z.object({
  documentId: z.string().uuid(),
  documentTitle: z.string(),
  category: z.string().nullable(),
  accessCount: z.number().int().nonnegative(),
});
export type KnowledgeArea = z.infer<typeof knowledgeAreaSchema>;

// activeUserCount/totalConversationCount/avgSessionDurationSeconds are computed from
// TrainingSession, which only the dashboard's own rehearsal surfaces
// (apps/dashboard/app/sessions, apps/dashboard/app/voice-ai) ever write — the anonymous public
// embed widget has no persisted row (see conversation-service.ts's
// ConversationHandlerDeps.trainingSessionId doc comment). These three fields measure trainer
// rehearsal activity in the dashboard, not production embed traffic — see dashboard-analytics.md's
// Overview. topKnowledgeAreas is the one field that reflects real, org-wide usage.
export const usageAnalyticsResponseSchema = z.object({
  windowDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  generatedAt: z.string(),
  activeUserCount: z.number().int().nonnegative(),
  totalConversationCount: z.number().int().nonnegative(),
  avgSessionDurationSeconds: z.number().nullable(),
  topKnowledgeAreas: z.array(knowledgeAreaSchema),
});
export type UsageAnalyticsResponse = z.infer<typeof usageAnalyticsResponseSchema>;

// GET /v1/analytics/training — see .claude/specs/training-analytics.md. Objectives with
// attemptedLearnerCount >= MIN_ATTEMPTS (2), ranked by passRate ascending, capped at 10 — see
// getTrainingAnalytics's module constants in analytics-service.ts.
export const knowledgeGapSchema = z.object({
  objectiveId: z.string().uuid(),
  objectiveTitle: z.string(),
  curriculumId: z.string().uuid(),
  curriculumTitle: z.string(),
  attemptedLearnerCount: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1),
});
export type KnowledgeGap = z.infer<typeof knowledgeGapSchema>;

// avgCompletionRate is the mean of PER-CURRICULUM completionRate (same definition
// curriculumEffectivenessSchema's completionRate uses — a learner counts as "completed" only
// once they've passed every current objective in that curriculum), averaged across curricula
// with >=1 ObjectiveProgress row only; null when no curriculum has any activity.
// avgTimeToCompetencySeconds is a flat mean across every PASS row org-wide, no per-curriculum
// averaging. Every field here shares ObjectiveProgress's dashboard-rehearsal-only limitation —
// see training-analytics.md's Scope-defining finding.
export const trainingAnalyticsResponseSchema = z.object({
  generatedAt: z.string(),
  participantCount: z.number().int().nonnegative(),
  curriculumsWithActivityCount: z.number().int().nonnegative(),
  avgCompletionRate: z.number().min(0).max(1).nullable(),
  avgTimeToCompetencySeconds: z.number().nullable(),
  knowledgeGaps: z.array(knowledgeGapSchema),
});
export type TrainingAnalyticsResponse = z.infer<typeof trainingAnalyticsResponseSchema>;

// GET /v1/analytics/performance — see .claude/specs/ai-performance-analytics.md. Unlike
// usageAnalyticsResponseSchema/trainingAnalyticsResponseSchema, every field here is real,
// org-wide production data: the turn pipeline these fields come from runs identically for the
// dashboard's own rehearsal surfaces and for real end-learners on the public apps/widget embed.
export const avgLatencyMsSchema = z.object({
  stt: z.number().nullable(),
  retrieval: z.number().nullable(),
  llmFirstToken: z.number().nullable(),
  ttsFirstChunk: z.number().nullable(),
  total: z.number().nullable(),
});
export type AvgLatencyMs = z.infer<typeof avgLatencyMsSchema>;

// One row per day, oldest first, always exactly TREND_DAYS entries (see
// getPerformanceAnalytics's module constant in analytics-service.ts) — a day with zero
// KnowledgeAccessEvent rows is included with accessCount: 0, not omitted.
export const knowledgeUtilizationTrendPointSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  accessCount: z.number().int().nonnegative(),
});
export type KnowledgeUtilizationTrendPoint = z.infer<typeof knowledgeUtilizationTrendPointSchema>;

// groundedReplyRate measures whether a reply was grounded in retrieved knowledge-base content
// (sources.length > 0 in conversation-service.ts) versus the ungrounded Priority-3 fallback —
// it is NOT a factual-accuracy judgment. Never label it "accuracy" in code or UI copy. There is
// no user-satisfaction field: no capture mechanism for it exists yet, and this spec does not add
// one — see ai-performance-analytics.md's Overview.
export const performanceAnalyticsResponseSchema = z.object({
  windowDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  generatedAt: z.string(),
  turnCount: z.number().int().nonnegative(),
  avgLatencyMs: avgLatencyMsSchema,
  groundedReplyRate: z.number().min(0).max(1).nullable(),
  knowledgeUtilizationTrend: z.array(knowledgeUtilizationTrendPointSchema),
});
export type PerformanceAnalyticsResponse = z.infer<typeof performanceAnalyticsResponseSchema>;
