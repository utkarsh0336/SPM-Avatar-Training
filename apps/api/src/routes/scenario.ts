import type { FastifyInstance } from "fastify";
import { objectiveIdParamSchema, replaceObjectiveScenarioRequestSchema } from "@avatrain/shared";
import { requireRole } from "../plugins/auth.js";
import * as scenarioService from "../services/scenario-service.js";

/**
 * Branching scenario authoring — SOW §3.5, see
 * .claude/specs/branching-scenario-questions.md. Its own route file, same precedent
 * checklist.ts already set for a curriculum-adjacent sub-resource kept separate from
 * curriculum.ts. OWNER-only, mirroring PUT /v1/curricula/:id/objectives's writeGate — content
 * authoring stays admin-level, no PARTNER access. orgId always comes from
 * request.authContext, never the request body/params.
 */
export function registerScenarioRoutes(app: FastifyInstance): void {
  const writeGate = { preHandler: [app.authenticate, requireRole("OWNER")] };

  app.put("/v1/objectives/:objectiveId/scenario", writeGate, async (request, reply) => {
    const { objectiveId } = objectiveIdParamSchema.parse(request.params);
    const { steps } = replaceObjectiveScenarioRequestSchema.parse(request.body);
    const saved = await scenarioService.replaceObjectiveScenario(request.authContext!.orgId, objectiveId, steps);
    reply.status(200).send({ steps: saved });
  });
}
