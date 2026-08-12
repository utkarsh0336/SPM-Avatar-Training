import type { FastifyInstance } from "fastify";
import { requireRole } from "../plugins/auth.js";
import * as avatarService from "../services/avatar-service.js";

/**
 * GET /v1/avatars — OWNER only, ACTIVE avatars for the caller's org. Powers
 * the Curriculum admin page's avatar picker; see
 * .claude/specs/interactive-assessment.md.
 */
export function registerAvatarRoutes(app: FastifyInstance): void {
  app.get("/v1/avatars", { preHandler: [app.authenticate, requireRole("OWNER")] }, async (request, reply) => {
    const avatars = await avatarService.listActiveAvatars(request.authContext!.orgId);
    reply.status(200).send({ avatars });
  });
}
