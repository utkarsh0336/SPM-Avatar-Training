import type { FastifyInstance } from "fastify";
import {
  createTrainingSessionRequestSchema,
  endTrainingSessionRequestSchema,
  listTrainingSessionMessagesQuerySchema,
  listTrainingSessionsQuerySchema,
  pinTrainingSessionRequestSchema,
  trainingSessionIdRouteParamSchema,
} from "@avatrain/shared";
import * as trainingSessionService from "../services/training-session-service.js";

/**
 * Session/conversation persistence — .claude/specs/video-chat-session.md (Milestone 2). Backs
 * both apps/dashboard/app/sessions (kind=VIDEO_CHAT) and apps/dashboard/app/voice-ai
 * (kind=VOICE_ONLY): both dashboard trees hit the identical
 * GET /v1/conversations/:trainingSessionId/ws route, so one kind-discriminated resource serves
 * both instead of duplicating CRUD. No role gate beyond authentication — nothing in this codebase
 * restricts who can rehearse with an org's avatars today. There is deliberately no
 * `POST .../messages` route: messages are written only from conversation-service.ts's trusted
 * realtime pipeline (persistTrainingSessionMessage), never accepted from a request body — see
 * .claude/rules/tenancy.md's "server re-checks entitlement rather than trusting model/client
 * arguments" posture, same one record_progress/grade_answer already follow.
 */
export function registerTrainingSessionRoutes(app: FastifyInstance): void {
  const gate = { preHandler: [app.authenticate] };

  app.post("/v1/training-sessions", gate, async (request, reply) => {
    const input = createTrainingSessionRequestSchema.parse(request.body);
    const trainingSession = await trainingSessionService.createTrainingSession(
      request.authContext!.orgId,
      request.authContext!.userId,
      input,
    );
    reply.status(201).send({ trainingSession });
  });

  app.get("/v1/training-sessions", gate, async (request, reply) => {
    const { kind } = listTrainingSessionsQuerySchema.parse(request.query);
    const result = await trainingSessionService.listTrainingSessions(
      request.authContext!.orgId,
      request.authContext!.userId,
      kind,
    );
    reply.status(200).send(result);
  });

  app.get("/v1/training-sessions/:trainingSessionId", gate, async (request, reply) => {
    const { trainingSessionId } = trainingSessionIdRouteParamSchema.parse(request.params);
    const trainingSession = await trainingSessionService.getTrainingSession(
      request.authContext!.orgId,
      trainingSessionId,
    );
    reply.status(200).send({ trainingSession });
  });

  app.get("/v1/training-sessions/:trainingSessionId/messages", gate, async (request, reply) => {
    const { trainingSessionId } = trainingSessionIdRouteParamSchema.parse(request.params);
    const query = listTrainingSessionMessagesQuerySchema.parse(request.query);
    const result = await trainingSessionService.listTrainingSessionMessages(
      request.authContext!.orgId,
      trainingSessionId,
      query,
    );
    reply.status(200).send(result);
  });

  app.post("/v1/training-sessions/:trainingSessionId/end", gate, async (request, reply) => {
    const { trainingSessionId } = trainingSessionIdRouteParamSchema.parse(request.params);
    const { reason } = endTrainingSessionRequestSchema.parse(request.body ?? {});
    const trainingSession = await trainingSessionService.endTrainingSession(
      request.authContext!.orgId,
      trainingSessionId,
      reason,
    );
    reply.status(200).send({ trainingSession });
  });

  app.patch("/v1/training-sessions/:trainingSessionId/pin", gate, async (request, reply) => {
    const { trainingSessionId } = trainingSessionIdRouteParamSchema.parse(request.params);
    const { pinned } = pinTrainingSessionRequestSchema.parse(request.body);
    const result = await trainingSessionService.setTrainingSessionPinned(
      request.authContext!.orgId,
      request.authContext!.userId,
      trainingSessionId,
      pinned,
    );
    reply.status(200).send(result);
  });
}
