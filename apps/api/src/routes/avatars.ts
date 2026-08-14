import type { FastifyInstance } from "fastify";
import { avatarIdParamSchema, createAvatarRequestSchema, onboardingDraftSchema } from "@avatrain/shared";
import { requireRole } from "../plugins/auth.js";
import { notFound } from "../lib/http-errors.js";
import * as avatarService from "../services/avatar-service.js";

/**
 * GET /v1/avatars — OWNER only, ACTIVE avatars for the caller's org. Powers
 * the Curriculum admin page's avatar picker; see
 * .claude/specs/interactive-assessment.md.
 *
 * GET /v1/avatars/mine, GET /v1/avatars/recommended, and GET
 * /v1/avatars/:avatarId are any-authenticated-user reads (no requireRole) —
 * they feed a live session's persona resolution (useConversationSession.ts,
 * NewSessionModal.tsx), not an admin surface. /recommended is the first of
 * these a MEMBER can use to discover the org's whole avatar catalog (/mine
 * is scoped to createdById, /all and the bare /avatars are OWNER-only) —
 * see .claude/specs/personalized-recommendation-engine.md.
 *
 * GET /v1/avatars/all, POST /v1/avatars, PATCH .../:avatarId, and the
 * publish/archive actions are OWNER-only, matching this file's existing
 * convention — multi-persona management is an admin surface. They
 * deliberately never call onboarding-service.ts's assertNotCompleted gate:
 * that gate exists only for the one-time wizard, not ongoing persona CRUD.
 *
 * Static segments ("mine", "all") registered before the parametric
 * (":avatarId") route for readability; find-my-way (Fastify's router)
 * already prioritizes static segments over parametric ones regardless of
 * registration order, so this isn't load-bearing, just conventional.
 */
export function registerAvatarRoutes(app: FastifyInstance): void {
  app.get("/v1/avatars", { preHandler: [app.authenticate, requireRole("OWNER")] }, async (request, reply) => {
    const avatars = await avatarService.listActiveAvatars(request.authContext!.orgId);
    reply.status(200).send({ avatars });
  });

  app.get("/v1/avatars/mine", { preHandler: app.authenticate }, async (request, reply) => {
    const { orgId, userId } = request.authContext!;
    const avatars = await avatarService.getMyAvatars(orgId, userId);
    reply.status(200).send({ avatars });
  });

  app.get("/v1/avatars/all", { preHandler: [app.authenticate, requireRole("OWNER")] }, async (request, reply) => {
    const avatars = await avatarService.listOrgAvatars(request.authContext!.orgId);
    reply.status(200).send({ avatars });
  });

  app.get("/v1/avatars/recommended", { preHandler: app.authenticate }, async (request, reply) => {
    const { orgId, userId, role } = request.authContext!;
    const avatars = await avatarService.getRecommendedAvatars(orgId, userId, role);
    reply.status(200).send({ avatars });
  });

  app.post("/v1/avatars", { preHandler: [app.authenticate, requireRole("OWNER")] }, async (request, reply) => {
    const { orgId, userId } = request.authContext!;
    const { name } = createAvatarRequestSchema.parse(request.body ?? {});
    const avatar = await avatarService.createAvatar(orgId, userId, name);
    reply.status(201).send({ avatar });
  });

  app.get("/v1/avatars/:avatarId", { preHandler: app.authenticate }, async (request, reply) => {
    const { orgId } = request.authContext!;
    const { avatarId } = avatarIdParamSchema.parse(request.params);
    const avatar = await avatarService.getAvatarById(orgId, avatarId);
    if (!avatar) throw notFound("avatar_not_found");
    reply.status(200).send({ avatar });
  });

  app.patch(
    "/v1/avatars/:avatarId",
    { preHandler: [app.authenticate, requireRole("OWNER")] },
    async (request, reply) => {
      const { orgId } = request.authContext!;
      const { avatarId } = avatarIdParamSchema.parse(request.params);
      const patch = onboardingDraftSchema.parse(request.body);
      const avatar = await avatarService.updateAvatar(orgId, avatarId, patch);
      reply.status(200).send({ avatar });
    },
  );

  app.post(
    "/v1/avatars/:avatarId/publish",
    { preHandler: [app.authenticate, requireRole("OWNER")] },
    async (request, reply) => {
      const { orgId } = request.authContext!;
      const { avatarId } = avatarIdParamSchema.parse(request.params);
      const avatar = await avatarService.publishAvatar(orgId, avatarId);
      reply.status(200).send({ avatar });
    },
  );

  app.post(
    "/v1/avatars/:avatarId/archive",
    { preHandler: [app.authenticate, requireRole("OWNER")] },
    async (request, reply) => {
      const { orgId } = request.authContext!;
      const { avatarId } = avatarIdParamSchema.parse(request.params);
      const avatar = await avatarService.archiveAvatar(orgId, avatarId);
      reply.status(200).send({ avatar });
    },
  );
}
