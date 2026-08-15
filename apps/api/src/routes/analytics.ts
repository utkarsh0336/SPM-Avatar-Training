import type { FastifyInstance } from "fastify";
import { usageAnalyticsQuerySchema } from "@avatrain/shared";
import { requireRole } from "../plugins/auth.js";
import * as analyticsService from "../services/analytics-service.js";

/**
 * Org-wide usage analytics (see .claude/specs/dashboard-analytics.md), org-wide training-outcomes
 * analytics (.claude/specs/training-analytics.md), and, since
 * .claude/specs/ai-performance-analytics.md, org-wide AI turn-performance analytics
 * (latency, grounded-reply rate, knowledge-utilization trend). Its own route file rather than
 * folded into org.ts (org-config only) or curriculum.ts (curriculum-scoped): these read across
 * TrainingSession/KnowledgeDocument, Objective/ObjectiveProgress/Curriculum, and TurnMetric, none
 * of which this file owns. OWNER-only, same gate as PATCH /v1/org/branding — org-wide numbers are
 * business-sensitive the same way branding is, and PARTNER (scoped to its own
 * PARTNER_ENABLEMENT curricula) has no reason to see them.
 */
export function registerAnalyticsRoutes(app: FastifyInstance): void {
  const gate = { preHandler: [app.authenticate, requireRole("OWNER")] };

  app.get("/v1/analytics/usage", gate, async (request, reply) => {
    const { days } = usageAnalyticsQuerySchema.parse(request.query);
    const result = await analyticsService.getUsageAnalytics(request.authContext!.orgId, days);
    reply.status(200).send(result);
  });

  app.get("/v1/analytics/training", gate, async (request, reply) => {
    const result = await analyticsService.getTrainingAnalytics(request.authContext!.orgId);
    reply.status(200).send(result);
  });

  // See .claude/specs/ai-performance-analytics.md. Reuses usageAnalyticsQuerySchema's exact
  // `days` shape — TurnMetric volume is unbounded like KnowledgeAccessEvent, so it needs the
  // same bounded-range guard.
  app.get("/v1/analytics/performance", gate, async (request, reply) => {
    const { days } = usageAnalyticsQuerySchema.parse(request.query);
    const result = await analyticsService.getPerformanceAnalytics(request.authContext!.orgId, days);
    reply.status(200).send(result);
  });
}
