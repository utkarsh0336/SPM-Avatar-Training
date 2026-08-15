import { z } from "zod";

// Mirror prisma/schema.prisma's TrainingSessionKind/TrainingSessionStatus/MessageRole enums, same
// redefinition convention as curriculum/schema.ts's programTypeSchema. Owned by
// .claude/specs/video-chat-session.md (Milestone 2).
export const trainingSessionKindSchema = z.enum(["VIDEO_CHAT", "VOICE_ONLY"]);
export type TrainingSessionKind = z.infer<typeof trainingSessionKindSchema>;

export const trainingSessionStatusSchema = z.enum(["ACTIVE", "ENDED"]);
export type TrainingSessionStatus = z.infer<typeof trainingSessionStatusSchema>;

export const messageRoleSchema = z.enum(["USER", "AVATAR", "SYSTEM"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

/**
 * Route param for /v1/training-sessions/:trainingSessionId/**. Deliberately a distinct, stricter
 * schema from realtime/ws-messages.ts's trainingSessionIdParamSchema (loose z.string().min(1)) —
 * that one is shared with the anonymous apps/widget embed path and must stay loose; these REST
 * routes are only ever hit with a real, server-minted uuid.
 */
export const trainingSessionIdRouteParamSchema = z.object({ trainingSessionId: z.string().uuid() });
export type TrainingSessionIdRouteParam = z.infer<typeof trainingSessionIdRouteParamSchema>;

/**
 * POST /v1/training-sessions. `voiceExpertId` is required for kind=VOICE_ONLY and forbidden for
 * kind=VIDEO_CHAT. `avatarId` is forbidden for kind=VOICE_ONLY but *optional* for kind=VIDEO_CHAT
 * — an omitted avatarId means "resolve the caller's own ACTIVE-first avatar server-side"
 * (training-session-service.ts's resolvePersona), the same default-persona fallback
 * useConversationSession.ts's client-side getMyAvatars() call already provides for the live
 * WS connection; onboarding's "Create Avatar & Start Session" (VoiceReviewStep.tsx) relies on
 * exactly this fallback, since it doesn't know the just-created avatar's id at that call site.
 * clientRequestId is a client-generated idempotency key (DB-unique per org); a retried create with
 * the same key returns the original row rather than erroring.
 */
export const createTrainingSessionRequestSchema = z
  .object({
    kind: trainingSessionKindSchema,
    title: z.string().trim().min(1).max(120),
    topic: z.string().trim().min(1).max(200).optional(),
    avatarId: z.string().uuid().optional(),
    voiceExpertId: z.string().min(1).optional(),
    clientRequestId: z.string().uuid(),
  })
  .refine((data) => (data.kind === "VIDEO_CHAT" ? !data.voiceExpertId : true), {
    message: "voiceExpertId must be omitted when kind is VIDEO_CHAT",
    path: ["voiceExpertId"],
  })
  .refine((data) => (data.kind === "VOICE_ONLY" ? Boolean(data.voiceExpertId) && !data.avatarId : true), {
    message: "voiceExpertId is required (and avatarId must be omitted) when kind is VOICE_ONLY",
    path: ["voiceExpertId"],
  });
export type CreateTrainingSessionRequest = z.infer<typeof createTrainingSessionRequestSchema>;

export const trainingSessionResultSchema = z.object({
  id: z.string().uuid(),
  kind: trainingSessionKindSchema,
  status: trainingSessionStatusSchema,
  title: z.string(),
  topic: z.string().nullable(),
  avatarId: z.string().uuid().nullable(),
  voiceExpertId: z.string().nullable(),
  personaName: z.string(),
  personaRole: z.string(),
  endReason: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TrainingSessionResult = z.infer<typeof trainingSessionResultSchema>;

export const createTrainingSessionResponseSchema = z.object({ trainingSession: trainingSessionResultSchema });
export type CreateTrainingSessionResponse = z.infer<typeof createTrainingSessionResponseSchema>;

export const getTrainingSessionResponseSchema = z.object({ trainingSession: trainingSessionResultSchema });
export type GetTrainingSessionResponse = z.infer<typeof getTrainingSessionResponseSchema>;

/** GET /v1/training-sessions?kind= — org-wide, unpaginated (matches listCurricula/listApplications). */
export const listTrainingSessionsQuerySchema = z.object({ kind: trainingSessionKindSchema });
export type ListTrainingSessionsQuery = z.infer<typeof listTrainingSessionsQuerySchema>;

export const listTrainingSessionsResponseSchema = z.object({
  pinned: z.array(trainingSessionResultSchema),
  recent: z.array(trainingSessionResultSchema),
});
export type ListTrainingSessionsResponse = z.infer<typeof listTrainingSessionsResponseSchema>;

export const messageResultSchema = z.object({
  id: z.string().uuid(),
  role: messageRoleSchema,
  content: z.string(),
  sequence: z.number().int(),
  createdAt: z.string(),
});
export type MessageResult = z.infer<typeof messageResultSchema>;

/** GET /v1/training-sessions/:trainingSessionId/messages?after=&limit= — keyset pagination on sequence. */
export const listTrainingSessionMessagesQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});
export type ListTrainingSessionMessagesQuery = z.infer<typeof listTrainingSessionMessagesQuerySchema>;

export const listTrainingSessionMessagesResponseSchema = z.object({
  messages: z.array(messageResultSchema),
  nextAfter: z.number().int().nullable(),
});
export type ListTrainingSessionMessagesResponse = z.infer<typeof listTrainingSessionMessagesResponseSchema>;

export const endTrainingSessionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(200).optional(),
});
export type EndTrainingSessionRequest = z.infer<typeof endTrainingSessionRequestSchema>;

export const endTrainingSessionResponseSchema = z.object({ trainingSession: trainingSessionResultSchema });
export type EndTrainingSessionResponse = z.infer<typeof endTrainingSessionResponseSchema>;

export const pinTrainingSessionRequestSchema = z.object({ pinned: z.boolean() });
export type PinTrainingSessionRequest = z.infer<typeof pinTrainingSessionRequestSchema>;

export const pinTrainingSessionResponseSchema = z.object({ pinned: z.boolean() });
export type PinTrainingSessionResponse = z.infer<typeof pinTrainingSessionResponseSchema>;
