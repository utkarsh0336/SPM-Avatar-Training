import type { FastifyInstance } from "fastify";
import {
  createCurriculumRequestSchema,
  curriculumIdParamSchema,
  replaceCurriculumObjectivesRequestSchema,
  updateCurriculumRequestSchema,
} from "@avatrain/shared";
import { requireRole } from "../plugins/auth.js";
import * as curriculumService from "../services/curriculum-service.js";

/**
 * Curriculum authoring/progress — SOW §3.4/§3.5, see
 * .claude/specs/interactive-assessment.md. Same OWNER-only gate as
 * knowledge.ts (content curation is admin-level until the Role enum grows a
 * finer tier). orgId/userId always come from request.authContext, never the
 * request body/params.
 */
export function registerCurriculumRoutes(app: FastifyInstance): void {
  const gate = { preHandler: [app.authenticate, requireRole("OWNER")] };

  app.post("/v1/curricula", gate, async (request, reply) => {
    const input = createCurriculumRequestSchema.parse(request.body);
    const result = await curriculumService.createCurriculum(
      request.authContext!.orgId,
      request.authContext!.userId,
      input,
    );
    reply.status(201).send(result);
  });

  app.get("/v1/curricula/:curriculumId", gate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    const result = await curriculumService.getCurriculum(request.authContext!.orgId, curriculumId);
    reply.status(200).send(result);
  });

  app.patch("/v1/curricula/:curriculumId", gate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    const patch = updateCurriculumRequestSchema.parse(request.body);
    const result = await curriculumService.updateCurriculum(request.authContext!.orgId, curriculumId, patch);
    reply.status(200).send(result);
  });

  app.put("/v1/curricula/:curriculumId/objectives", gate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    const { objectives } = replaceCurriculumObjectivesRequestSchema.parse(request.body);
    const saved = await curriculumService.replaceObjectives(request.authContext!.orgId, curriculumId, objectives);
    reply.status(200).send({ objectives: saved });
  });

  app.delete("/v1/curricula/:curriculumId", gate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    await curriculumService.deleteCurriculum(request.authContext!.orgId, curriculumId);
    reply.status(204).send();
  });

  app.get("/v1/curricula/:curriculumId/progress", gate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    const progress = await curriculumService.listCurriculumProgress(request.authContext!.orgId, curriculumId);
    reply.status(200).send({ progress });
  });
}
