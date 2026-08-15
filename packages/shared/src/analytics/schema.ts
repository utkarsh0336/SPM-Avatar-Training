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
