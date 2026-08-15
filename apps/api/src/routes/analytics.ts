import type { FastifyInstance } from "fastify";
import { usageAnalyticsQuerySchema } from "@avatrain/shared";
import { requireRole } from "../plugins/auth.js";
import * as analyticsService from "../services/analytics-service.js";

/**
 * Org-wide usage analytics — see .claude/specs/dashboard-analytics.md. Its own route file rather
 * than folded into org.ts (org-config only) or curriculum.ts (curriculum-scoped): this reads
 * across TrainingSession and KnowledgeDocument, neither of which this file owns. OWNER-only, same
 * gate as PATCH /v1/org/branding — org-wide usage numbers are business-sensitive the same way
 * branding is, and PARTNER (scoped to its own PARTNER_ENABLEMENT curricula) has no reason to see
 * them.
 */
export function registerAnalyticsRoutes(app: FastifyInstance): void {
  const gate = { preHandler: [app.authenticate, requireRole("OWNER")] };

  app.get("/v1/analytics/usage", gate, async (request, reply) => {
    const { days } = usageAnalyticsQuerySchema.parse(request.query);
    const result = await analyticsService.getUsageAnalytics(request.authContext!.orgId, days);
    reply.status(200).send(result);
  });
}
