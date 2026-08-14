import type { FastifyInstance } from "fastify";
import {
  createCurriculumRequestSchema,
  curriculumIdParamSchema,
  replaceCurriculumObjectivesRequestSchema,
  updateCurriculumRequestSchema,
} from "@avatrain/shared";
import { requireAnyRole, requireRole } from "../plugins/auth.js";
import * as curriculumService from "../services/curriculum-service.js";

/**
 * Curriculum authoring/progress — SOW §3.4/§3.5, see
 * .claude/specs/interactive-assessment.md. Authoring (create/update/replace
 * objectives/delete) stays OWNER-only via writeGate — content curation is
 * still admin-level. Reads (list/get/progress) use readGate, added by
 * .claude/specs/partner-role.md: a PARTNER may read, but curriculum-service.ts
 * silently narrows what a PARTNER sees to PARTNER_ENABLEMENT-tagged
 * curricula (404, not empty/403, for anything else — see
 * assertVisibleTo's doc comment there). orgId/userId always come from
 * request.authContext, never the request body/params.
 */
export function registerCurriculumRoutes(app: FastifyInstance): void {
  const writeGate = { preHandler: [app.authenticate, requireRole("OWNER")] };
  const readGate = { preHandler: [app.authenticate, requireAnyRole(["OWNER", "PARTNER"])] };

  app.post("/v1/curricula", writeGate, async (request, reply) => {
    const input = createCurriculumRequestSchema.parse(request.body);
    const result = await curriculumService.createCurriculum(
      request.authContext!.orgId,
      request.authContext!.userId,
      input,
    );
    reply.status(201).send(result);
  });

  app.get("/v1/curricula", readGate, async (request, reply) => {
    const curricula = await curriculumService.listCurricula(request.authContext!.orgId, request.authContext!.role);
    reply.status(200).send({ curricula });
  });

  app.get("/v1/curricula/:curriculumId", readGate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    const result = await curriculumService.getCurriculum(
      request.authContext!.orgId,
      curriculumId,
      request.authContext!.role,
    );
    reply.status(200).send(result);
  });

  app.patch("/v1/curricula/:curriculumId", writeGate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    const patch = updateCurriculumRequestSchema.parse(request.body);
    const result = await curriculumService.updateCurriculum(request.authContext!.orgId, curriculumId, patch);
    reply.status(200).send(result);
  });

  app.put("/v1/curricula/:curriculumId/objectives", writeGate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    const { objectives } = replaceCurriculumObjectivesRequestSchema.parse(request.body);
    const saved = await curriculumService.replaceObjectives(request.authContext!.orgId, curriculumId, objectives);
    reply.status(200).send({ objectives: saved });
  });

  app.delete("/v1/curricula/:curriculumId", writeGate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    await curriculumService.deleteCurriculum(request.authContext!.orgId, curriculumId);
    reply.status(204).send();
  });

  app.get("/v1/curricula/:curriculumId/progress", readGate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    const progress = await curriculumService.listCurriculumProgress(
      request.authContext!.orgId,
      curriculumId,
      request.authContext!.role,
    );
    reply.status(200).send({ progress });
  });

  app.get("/v1/curricula/:curriculumId/effectiveness", readGate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    const result = await curriculumService.getCurriculumEffectiveness(
      request.authContext!.orgId,
      curriculumId,
      request.authContext!.role,
    );
    reply.status(200).send(result);
  });
}
