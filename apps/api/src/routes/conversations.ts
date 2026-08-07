import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { trainingSessionIdParamSchema } from "@avatrain/shared";
import { checkRateLimit } from "../lib/rate-limit.js";
import { unauthorized } from "../lib/http-errors.js";
import { mintWsTicket, redeemWsTicket, type WsTicketClaims } from "../lib/ws-tickets.js";
import { createConversationHandler } from "../services/conversation-service.js";

declare module "fastify" {
  interface FastifyRequest {
    wsClaims?: WsTicketClaims;
  }
}

// Ticket minting is cheap but still gated — an unbounded mint loop would
// let an authenticated trainer hand out tickets faster than sessions could
// ever use them, which is only useful as an abuse vector.
const TICKET_RATE_LIMIT = { max: 20, windowMs: 5 * 60_000 };

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
