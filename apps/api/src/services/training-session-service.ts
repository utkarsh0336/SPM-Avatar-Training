import {
  expertiseTopicTitle,
  getVoiceExpertSummaryById,
  isUniqueConstraintError,
  redact,
  withOrg,
  type CreateTrainingSessionRequest,
  type ListTrainingSessionMessagesQuery,
  type MessageResult,
  type MessageRole,
  type TrainingSessionKind,
  type TrainingSessionResult,
} from "@avatrain/shared";
import type { TrainingSession } from "@prisma/client";
import { badRequest, notFound } from "../lib/http-errors.js";
import { getMyAvatars } from "./avatar-service.js";

function toTrainingSessionResult(session: TrainingSession): TrainingSessionResult {
  return {
    id: session.id,
    kind: session.kind,
    status: session.status,
    title: session.title,
    topic: session.topic,
    avatarId: session.avatarId,
    voiceExpertId: session.voiceExpertId,
    personaName: session.personaName,
    personaRole: session.personaRole,
    endReason: session.endReason,
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

interface ResolvedPersona {
  avatarId: string | null;
  voiceExpertId: string | null;
  personaName: string;
  personaRole: string;
}

/**
 * Resolves and validates the persona server-side — never trusts a client-supplied display name,
 * same posture avatar-service.ts's getAvatarById already takes elsewhere. VOICE_ONLY must resolve
 * to a known entry in the shared voice-expert catalog (there is no VoiceExpert table — see
 * packages/shared/src/training-session/voice-experts.ts). createTrainingSessionRequestSchema's
 * refine already guarantees voiceExpertId is only ever set for VOICE_ONLY.
 *
 * VIDEO_CHAT with an explicit avatarId must resolve to an ACTIVE Avatar in this org. VIDEO_CHAT
 * with avatarId omitted falls back to the caller's own ACTIVE-first avatar via getMyAvatars —
 * mirroring useConversationSession.ts's client-side getMyAvatars() fallback for the live WS
 * connection itself, and *not* re-checking ACTIVE here: that fallback is "give me my default
 * persona, whatever its status," the same leniency the client hook already has, not a second gate
 * on top of an explicitly-chosen avatarId.
 */
async function resolvePersona(orgId: string, userId: string, input: CreateTrainingSessionRequest): Promise<ResolvedPersona> {
  if (input.kind === "VIDEO_CHAT") {
    if (input.avatarId) {
      const avatar = await withOrg(orgId, (tx) => tx.avatar.findFirst({ where: { id: input.avatarId, orgId } }));
      if (!avatar) throw notFound("avatar_not_found");
      if (avatar.status !== "ACTIVE") throw badRequest("avatar_not_active");
      return {
        avatarId: avatar.id,
        voiceExpertId: null,
        personaName: avatar.name ?? "Untitled Avatar",
        personaRole: avatar.expertise ? expertiseTopicTitle(avatar.expertise) : "AI Trainer",
      };
    }

    const [fallback] = await getMyAvatars(orgId, userId);
    if (!fallback) throw badRequest("no_avatar_available");
    return {
      avatarId: fallback.id,
      voiceExpertId: null,
      personaName: fallback.name ?? "Untitled Avatar",
      personaRole: fallback.expertise ? expertiseTopicTitle(fallback.expertise) : "AI Trainer",
    };
  }

  const expert = getVoiceExpertSummaryById(input.voiceExpertId as string);
  if (!expert) throw badRequest("unknown_voice_expert");
  return { avatarId: null, voiceExpertId: expert.id, personaName: expert.name, personaRole: expert.role };
}

/**
 * POST /v1/training-sessions. clientRequestId is a DB-unique (per org) idempotency key: a retried
 * create with the same key returns the original row rather than erroring, same
 * isUniqueConstraintError-catch-and-refetch pattern createCurriculum uses for its own unique
 * constraint (curriculum-service.ts).
 */
export async function createTrainingSession(
  orgId: string,
  userId: string,
  input: CreateTrainingSessionRequest,
): Promise<TrainingSessionResult> {
  const persona = await resolvePersona(orgId, userId, input);

  try {
    const session = await withOrg(orgId, (tx) =>
      tx.trainingSession.create({
        data: {
          orgId,
          createdByUserId: userId,
          clientRequestId: input.clientRequestId,
          kind: input.kind,
          title: input.title,
          topic: input.topic ?? null,
          avatarId: persona.avatarId,
          voiceExpertId: persona.voiceExpertId,
          personaName: persona.personaName,
          personaRole: persona.personaRole,
        },
      }),
    );
    return toTrainingSessionResult(session);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await withOrg(orgId, (tx) =>
        tx.trainingSession.findFirst({ where: { orgId, clientRequestId: input.clientRequestId } }),
      );
      if (existing) return toTrainingSessionResult(existing);
    }
    throw error;
  }
}

export interface ListedTrainingSessions {
  pinned: TrainingSessionResult[];
  recent: TrainingSessionResult[];
}

/**
 * GET /v1/training-sessions?kind= — org-wide (matches listCurricula/listApplications's
 * convention, not creator-scoped: the reference session list shows every trainer's rehearsal
 * sessions together), unpaginated (no list endpoint in this codebase paginates today). `pinned` is
 * this caller's own TrainingSessionPin rows — a pin is per-(user, session), never shared.
 */
export async function listTrainingSessions(
  orgId: string,
  userId: string,
  kind: TrainingSessionKind,
): Promise<ListedTrainingSessions> {
  return withOrg(orgId, async (tx) => {
    const [sessions, pins] = await Promise.all([
      tx.trainingSession.findMany({ where: { orgId, kind }, orderBy: { updatedAt: "desc" } }),
      tx.trainingSessionPin.findMany({ where: { orgId, userId } }),
    ]);
    const pinnedIds = new Set(pins.map((pin) => pin.trainingSessionId));
    const pinned: TrainingSessionResult[] = [];
    const recent: TrainingSessionResult[] = [];
    for (const session of sessions) {
      (pinnedIds.has(session.id) ? pinned : recent).push(toTrainingSessionResult(session));
    }
    return { pinned, recent };
  });
}

export async function getTrainingSession(orgId: string, trainingSessionId: string): Promise<TrainingSessionResult> {
  const session = await withOrg(orgId, (tx) =>
    tx.trainingSession.findFirst({ where: { id: trainingSessionId, orgId } }),
  );
  if (!session) throw notFound("training_session_not_found");
  return toTrainingSessionResult(session);
}

/**
 * Internal — apps/api/src/routes/conversations.ts's WS `preValidation` hook and the
 * `livekit-connect` route call this, not a REST endpoint. Returns null for missing/other-org
 * (RLS-backed), matching .claude/rules/tenancy.md's "return zero rows" isolation convention —
 * callers turn that into a 404, never a 403, so a caller can't distinguish "not yours" from
 * "doesn't exist."
 */
export async function getTrainingSessionForConnect(
  orgId: string,
  trainingSessionId: string,
): Promise<{ id: string; status: TrainingSession["status"] } | null> {
  return withOrg(orgId, (tx) =>
    tx.trainingSession.findFirst({ where: { id: trainingSessionId, orgId }, select: { id: true, status: true } }),
  );
}

function toMessageResult(row: {
  id: string;
  role: MessageRole;
  content: string;
  sequence: number;
  createdAt: Date;
}): MessageResult {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    sequence: row.sequence,
    createdAt: row.createdAt.toISOString(),
  };
}

const DEFAULT_MESSAGES_PAGE_SIZE = 50;

/**
 * GET /v1/training-sessions/:trainingSessionId/messages — keyset pagination on the integer
 * `sequence` column (simpler than an opaque cursor; no cursor-pagination precedent exists
 * anywhere else in this codebase to match either way). Read-only — there is no corresponding
 * public write route; rows are inserted only by persistTrainingSessionMessage below, from
 * conversation-service.ts's trusted realtime pipeline.
 */
export async function listTrainingSessionMessages(
  orgId: string,
  trainingSessionId: string,
  query: ListTrainingSessionMessagesQuery,
): Promise<{ messages: MessageResult[]; nextAfter: number | null }> {
  const session = await withOrg(orgId, (tx) =>
    tx.trainingSession.findFirst({ where: { id: trainingSessionId, orgId } }),
  );
  if (!session) throw notFound("training_session_not_found");

  const limit = query.limit ?? DEFAULT_MESSAGES_PAGE_SIZE;
  const rows = await withOrg(orgId, (tx) =>
    tx.message.findMany({
      where: { orgId, trainingSessionId, ...(query.after !== undefined ? { sequence: { gt: query.after } } : {}) },
      orderBy: { sequence: "asc" },
      take: limit + 1,
    }),
  );

  const page = rows.slice(0, limit);
  const nextAfter = rows.length > limit ? (page[page.length - 1]?.sequence ?? null) : null;
  return { messages: page.map(toMessageResult), nextAfter };
}

/**
 * POST /v1/training-sessions/:trainingSessionId/end — idempotent: ending an already-ENDED session
 * returns the existing row rather than erroring, so a click racing a `disconnect()`-triggered call
 * is harmless.
 */
export async function endTrainingSession(
  orgId: string,
  trainingSessionId: string,
  reason?: string,
): Promise<TrainingSessionResult> {
  const session = await withOrg(orgId, (tx) =>
    tx.trainingSession.findFirst({ where: { id: trainingSessionId, orgId } }),
  );
  if (!session) throw notFound("training_session_not_found");
  if (session.status === "ENDED") return toTrainingSessionResult(session);

  const ended = await withOrg(orgId, (tx) =>
    tx.trainingSession.update({
      where: { id: trainingSessionId },
      data: { status: "ENDED", endedAt: new Date(), endReason: reason ?? "USER_ENDED" },
    }),
  );
  return toTrainingSessionResult(ended);
}

/**
 * PATCH /v1/training-sessions/:trainingSessionId/pin — upserts/deletes the caller's own
 * TrainingSessionPin row. Row existence is the pin state; there is no boolean column to flip.
 */
export async function setTrainingSessionPinned(
  orgId: string,
  userId: string,
  trainingSessionId: string,
  pinned: boolean,
): Promise<{ pinned: boolean }> {
  const session = await withOrg(orgId, (tx) =>
    tx.trainingSession.findFirst({ where: { id: trainingSessionId, orgId } }),
  );
  if (!session) throw notFound("training_session_not_found");

  await withOrg(orgId, async (tx) => {
    if (pinned) {
      await tx.trainingSessionPin.upsert({
        where: { userId_trainingSessionId: { userId, trainingSessionId } },
        create: { orgId, userId, trainingSessionId },
        update: {},
      });
    } else {
      await tx.trainingSessionPin.deleteMany({ where: { orgId, userId, trainingSessionId } });
    }
  });
  return { pinned };
}

/**
 * Server-only, called fire-and-forget (`void`, never awaited) from conversation-service.ts's
 * processTurn, directly on the WS realtime hot path — per CLAUDE.md's "avoid blocking the
 * realtime audio path," this function must never be awaited by its caller and must never throw
 * out of that call site, so every failure is caught and logged here instead of propagating.
 * `content` is passed through redact() before insert, per .claude/rules/tenancy.md ("redact PII
 * before insert, never on read") — redact() is still a Phase-0 no-op stub, flagged to
 * security-reviewer, not silently shipped as if PII scrubbing were real. Also bumps
 * TrainingSession.updatedAt so "recent" list ordering reflects real activity with no separate
 * heartbeat mechanism.
 *
 * `sequence` is computed here (MAX(sequence)+1 for this trainingSessionId, inside the same
 * transaction as the insert) rather than accepted as a caller-tracked counter — a per-connection
 * in-memory counter would restart at 0 on every WS reconnect into a still-ACTIVE session (see
 * "Resume previous conversations" in .claude/specs/video-chat-session.md), colliding with
 * already-persisted rows and silently dropping every turn from the reconnect (security-reviewer
 * caught this in an earlier version). Retries once on a unique-constraint hit — two tabs racing
 * the same trainingSessionId (not prevented; see that spec's Explicit Non-Goals) could otherwise
 * lose a turn to the same race a single fixed retry cheaply closes.
 */
export async function persistTrainingSessionMessage(
  orgId: string,
  trainingSessionId: string,
  role: MessageRole,
  content: string,
): Promise<void> {
  const redacted = redact(content);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await withOrg(orgId, async (tx) => {
        const { _max } = await tx.message.aggregate({ where: { trainingSessionId }, _max: { sequence: true } });
        const sequence = (_max.sequence ?? -1) + 1;
        await tx.message.create({ data: { orgId, trainingSessionId, role, content: redacted, sequence } });
        // No-op data write, just to bump the @updatedAt timestamp.
        await tx.trainingSession.update({ where: { id: trainingSessionId }, data: {} });
      });
      return;
    } catch (error) {
      if (attempt === 0 && isUniqueConstraintError(error)) continue;
      console.error("persistTrainingSessionMessage failed", { orgId, trainingSessionId, role }, error);
      return;
    }
  }
}
