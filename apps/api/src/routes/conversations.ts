import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { checkRateLimit, prisma, trainingSessionIdParamSchema } from "@avatrain/shared";
import { conflict, forbidden, notFound, serviceUnavailable, unauthorized } from "../lib/http-errors.js";
import { isSimliConfigured, mintSimliSession } from "../lib/simli.js";
import { createLiveKitRoom, isLiveKitConfigured, mintLiveKitToken } from "../lib/livekit.js";
import { mintWsTicket, redeemWsTicket, type WsTicketClaims } from "../lib/ws-tickets.js";
import { createConversationHandler } from "../services/conversation-service.js";
import { getCallerSimliFaceId } from "../services/onboarding-service.js";
import { getTrainingSessionForConnect } from "../services/training-session-service.js";

declare module "fastify" {
  interface FastifyRequest {
    wsClaims?: WsTicketClaims;
    /**
     * Set by the WS route's preValidation hook (authenticated dashboard callers only — see
     * .claude/specs/video-chat-session.md, Milestone 2) once trainingSessionId has been resolved
     * against a real, org-owned TrainingSession row. Left unset for anonymous apps/widget embed
     * connections (claims.pinnedAvatarId set), which have no persisted row to resolve.
     */
    resolvedTrainingSessionId?: string;
  }
}

// Ticket minting is cheap but still gated — an unbounded mint loop would
// let an authenticated trainer hand out tickets faster than sessions could
// ever use them, which is only useful as an abuse vector.
const TICKET_RATE_LIMIT = { max: 20, windowMs: 5 * 60_000 };

// Tighter than TICKET_RATE_LIMIT — Simli is a paid API (unlike the free WS
// ticket), so an unbounded mint loop here directly costs money, not just
// invites abuse. See .claude/specs/avatar-builder-customization.md.
const SIMLI_SESSION_RATE_LIMIT = { max: 10, windowMs: 5 * 60_000 };

// Same tier as SIMLI_SESSION_RATE_LIMIT — Mode B mediates a paid, metered
// LiveKit room + agent worker, not a free resource like the WS ticket.
const LIVEKIT_CONNECT_RATE_LIMIT = { max: 10, windowMs: 5 * 60_000 };

export function registerConversationRoutes(app: FastifyInstance): void {
  app.post("/v1/conversations/ticket", { preHandler: app.authenticate }, async (request, reply) => {
    const key = `conversation-ticket:${request.authContext!.userId}`;
    if (!(await checkRateLimit(key, TICKET_RATE_LIMIT))) throw unauthorized("rate_limited");

    const { ticket, expiresAt } = await mintWsTicket({
      orgId: request.authContext!.orgId,
      userId: request.authContext!.userId,
    });
    reply.status(201).send({ ticket, expiresAt });
  });

  // Opt-in, paid-provider counterpart to /v1/conversations/ticket — only
  // ever reachable when AVATAR_PROVIDER=simli is actually configured (see
  // isSimliConfigured). Mints a short-lived Simli session_token server-side
  // so the browser's SimliAvatarProvider never sees SIMLI_API_KEY. Used
  // identically by the Avatar Builder's live preview and a real training
  // session — both just ask "give me a Simli session for my avatar," and
  // the faceId is resolved from the caller's own persisted Avatar record
  // below, never accepted from the request body.
  app.post(
    "/v1/conversations/simli-session",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!isSimliConfigured()) throw serviceUnavailable("simli_not_configured");

      const key = `simli-session:${request.authContext!.userId}`;
      if (!(await checkRateLimit(key, SIMLI_SESSION_RATE_LIMIT))) throw unauthorized("rate_limited");

      const { orgId, userId } = request.authContext!;
      const faceId = await getCallerSimliFaceId(orgId, userId);
      const { sessionToken, iceServers } = await mintSimliSession({ faceId });
      reply.status(201).send({ sessionToken, iceServers });
    },
  );

  // Mode B (LiveKit) credential-minting route — additive to the default WS
  // transport above, reachable only for Enterprise-plan orgs and only when
  // FEATURE_LIVEKIT_ENABLED is set. See
  // .claude/specs/real-time-video-avatar-interaction.md.
  app.post(
    "/v1/conversations/:trainingSessionId/livekit-connect",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (process.env.FEATURE_LIVEKIT_ENABLED !== "true" || !isLiveKitConfigured()) {
        throw serviceUnavailable("feature_disabled");
      }

      const { trainingSessionId } = trainingSessionIdParamSchema.parse(request.params);
      const { orgId, userId } = request.authContext!;

      const key = `livekit-connect:${userId}`;
      if (!(await checkRateLimit(key, LIVEKIT_CONNECT_RATE_LIMIT))) throw unauthorized("rate_limited");

      // Fresh read, never client-supplied — same "organizations is RLS-exempt,
      // direct prisma.organization.findUniqueOrThrow" posture org-service.ts
      // already documents for itself.
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { plan: true },
      });
      if (org.plan !== "ENTERPRISE") throw forbidden("plan_not_enterprise");

      // Ownership/existence is the real TrainingSession row now, not an in-memory guess — a
      // second org can't even address another org's id (RLS-backed, returns null here). See
      // lib/livekit.ts's createLiveKitRoom doc comment.
      const trainingSession = await getTrainingSessionForConnect(orgId, trainingSessionId);
      if (!trainingSession) throw notFound("training_session_not_found");
      if (trainingSession.status === "ENDED") throw conflict("session_ended");

      const { roomName } = await createLiveKitRoom(trainingSessionId, orgId);
      const { livekitUrl, roomToken } = await mintLiveKitToken({ roomName, orgId });
      reply.status(201).send({ livekitUrl, roomToken, roomName });
    },
  );

  app.get(
    "/v1/conversations/:trainingSessionId/ws",
    {
      websocket: true,
      // Runs before the WS upgrade completes (per @fastify/websocket's
      // documented hook support), so an invalid/expired/reused ticket gets
      // a normal 401 response instead of an upgrade-then-immediately-close.
      preValidation: async (request: FastifyRequest) => {
        const { trainingSessionId } = trainingSessionIdParamSchema.parse(request.params);
        const query = request.query as { ticket?: string };
        const claims = query.ticket ? await redeemWsTicket(query.ticket) : null;
        if (!claims) throw unauthorized("invalid_ticket");
        request.wsClaims = claims;

        // Anonymous apps/widget embed connections (claims.pinnedAvatarId set) have no persisted
        // TrainingSession row to resolve against — same boundary the Authentication spec drew
        // around apps/widget; skip entirely, leaving resolvedTrainingSessionId unset. An
        // authenticated dashboard caller (video or voice tree — both hit this same route) must
        // resolve to a real, org-owned, still-ACTIVE session.
        if (!claims.pinnedAvatarId) {
          const trainingSession = await getTrainingSessionForConnect(claims.orgId, trainingSessionId);
          if (!trainingSession) throw notFound("training_session_not_found");
          if (trainingSession.status === "ENDED") throw conflict("session_ended");
          request.resolvedTrainingSessionId = trainingSession.id;
        }
      },
    },
    (socket: WebSocket, request: FastifyRequest) => {
      createConversationHandler(socket, request.wsClaims!, {
        trainingSessionId: request.resolvedTrainingSessionId ?? null,
      });
    },
  );
}
