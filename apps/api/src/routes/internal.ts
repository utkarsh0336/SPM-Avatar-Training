import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createIncidentRequestSchema,
  incidentIdRouteParamSchema,
  updateIncidentRequestSchema,
  uptimeCheckReportSchema,
} from "@avatrain/shared";
import { loadApiConfig } from "../config.js";
import { serviceUnavailable, unauthorized } from "../lib/http-errors.js";
import { createIncident, recordUptimeCheck, updateIncident } from "../services/status-service.js";

/**
 * SHA-256 both sides first so timingSafeEqual always compares equal-length
 * (32-byte) buffers — it throws on a length mismatch rather than returning
 * false, and comparing raw variable-length strings would let a length
 * difference short-circuit before the constant-time comparison even runs.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * A single shared bearer token, entirely separate from the customer/org
 * JWT+session path in plugins/auth.ts — these routes authorize platform
 * operators (the synthetic-check and backup-verification GitHub Actions
 * workflows) writing infra-state rows, never tenant data. Fails CLOSED
 * (503, not silently-open) when INTERNAL_OPS_TOKEN isn't configured — apps/
 * api/src/config.ts made the var optional specifically so buildApp() and
 * every other route's tests keep working before this token is provisioned;
 * "not configured" must mean "these two routes are unusable," never "these
 * two routes skip auth."
 *
 * Reads env fresh on every request (loadApiConfig() is a cheap, pure Zod
 * parse) rather than caching it once at module load like most other config
 * consumption in this codebase — deliberately, so this security-sensitive
 * toggle is never stale relative to whatever the process's actual env is
 * right now, and so it's directly testable via process.env mutation without
 * dynamic-import gymnastics.
 */
async function requireInternalOpsToken(request: FastifyRequest): Promise<void> {
  const config = loadApiConfig();
  if (!config.INTERNAL_OPS_TOKEN) {
    throw serviceUnavailable("internal_ops_disabled", "INTERNAL_OPS_TOKEN is not configured");
  }

  const header = request.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

  if (!constantTimeEquals(presented, config.INTERNAL_OPS_TOKEN)) {
    throw unauthorized("invalid_internal_ops_token");
  }
}

export function registerInternalRoutes(app: FastifyInstance): void {
  const gate = { preHandler: [requireInternalOpsToken] };

  app.post("/v1/internal/uptime-checks", gate, async (request, reply) => {
    const input = uptimeCheckReportSchema.parse(request.body);
    await recordUptimeCheck(input);
    reply.status(201).send({ status: "recorded" });
  });

  app.post("/v1/internal/incidents", gate, async (request, reply) => {
    const input = createIncidentRequestSchema.parse(request.body);
    const incident = await createIncident(input);
    reply.status(201).send({ incident });
  });

  app.patch("/v1/internal/incidents/:incidentId", gate, async (request, reply) => {
    const { incidentId } = incidentIdRouteParamSchema.parse(request.params);
    const input = updateIncidentRequestSchema.parse(request.body);
    const incident = await updateIncident(incidentId, input);
    reply.status(200).send({ incident });
  });
}
