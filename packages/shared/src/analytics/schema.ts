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
