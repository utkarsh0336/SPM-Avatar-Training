import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { prisma, trainingSessionIdParamSchema } from "@avatrain/shared";
import { checkRateLimit } from "../lib/rate-limit.js";
import { conflict, forbidden, serviceUnavailable, unauthorized } from "../lib/http-errors.js";
import { isSimliConfigured, mintSimliSession } from "../lib/simli.js";
import {
  checkSessionNotEnded,
  createLiveKitRoom,
  isLiveKitConfigured,
  mintLiveKitToken,
  RoomOwnershipMismatchError,
} from "../lib/livekit.js";
import { mintWsTicket, redeemWsTicket, type WsTicketClaims } from "../lib/ws-tickets.js";
import { createConversationHandler } from "../services/conversation-service.js";
import { getCallerSimliFaceId } from "../services/onboarding-service.js";

declare module "fastify" {
  interface FastifyRequest {
    wsClaims?: WsTicketClaims;
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
    if (!checkRateLimit(key, TICKET_RATE_LIMIT)) throw unauthorized("rate_limited");

    const { ticket, expiresAt } = mintWsTicket({
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
      if (!checkRateLimit(key, SIMLI_SESSION_RATE_LIMIT)) throw unauthorized("rate_limited");

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
      if (!checkRateLimit(key, LIVEKIT_CONNECT_RATE_LIMIT)) throw unauthorized("rate_limited");

      // Fresh read, never client-supplied — same "organizations is RLS-exempt,
      // direct prisma.organization.findUniqueOrThrow" posture org-service.ts
      // already documents for itself.
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { plan: true },
      });
      if (org.plan !== "ENTERPRISE") throw forbidden("plan_not_enterprise");

      try {
        if (!(await checkSessionNotEnded(trainingSessionId, orgId))) throw conflict("session_ended");
        const { roomName } = await createLiveKitRoom(trainingSessionId, orgId);
        const { livekitUrl, roomToken } = await mintLiveKitToken({ roomName, orgId });
        reply.status(201).send({ livekitUrl, roomToken, roomName });
      } catch (err) {
        if (err instanceof RoomOwnershipMismatchError) {
          throw forbidden("training_session_owned_by_another_org");
        }
        throw err;
      }
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
        trainingSessionIdParamSchema.parse(request.params);
        const query = request.query as { ticket?: string };
        const claims = query.ticket ? redeemWsTicket(query.ticket) : null;
        if (!claims) throw unauthorized("invalid_ticket");
        request.wsClaims = claims;
      },
    },
    (socket: WebSocket, request: FastifyRequest) => {
      createConversationHandler(socket, request.wsClaims!);
    },
  );
}
