import { AccessToken, RoomServiceClient, type RoomAgentDispatch } from "livekit-server-sdk";
import { generateOpaqueToken, LIVEKIT_AGENT_NAME, liveKitRoomName } from "@avatrain/shared";

/**
 * Mode B (LiveKit) is opt-in — only reachable when all three vars are
 * configured, same posture as apps/api/src/lib/simli.ts's isSimliConfigured.
 * FEATURE_LIVEKIT_ENABLED is a separate, independent gate (see
 * routes/conversations.ts) — this only asks "could Mode B even work."
 */
export function isLiveKitConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
}

function requireLiveKitEnv(env: NodeJS.ProcessEnv): { url: string; apiKey: string; apiSecret: string } {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = env;
  if (!url || !apiKey || !apiSecret) {
    throw new Error("LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must all be set — see .env.example.");
  }
  return { url, apiKey, apiSecret };
}

// LiveKit's Twirp RPC client wants an https:// host, not the wss:// URL a
// browser/agent uses to actually join a room — same value, different scheme,
// per RoomServiceClient's own constructor docs ("hostname including
// protocol").
function toHttpHost(livekitUrl: string): string {
  return livekitUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}

type RoomServiceClientLike = Pick<RoomServiceClient, "createRoom" | "listRooms">;

/** Injectable for tests; defaults to the real RoomServiceClient constructor. */
export type CreateRoomServiceClient = (host: string, apiKey: string, apiSecret: string) => RoomServiceClientLike;

const defaultCreateRoomServiceClient: CreateRoomServiceClient = (host, apiKey, apiSecret) =>
  new RoomServiceClient(host, apiKey, apiSecret);

/**
 * Thrown when a trainingSessionId already belongs to a different org's room.
 * `trainingSessionId` is a human-readable, guessable slug (e.g.
 * "sales-pitch-practice") with no persisted-ownership record anywhere in
 * this codebase (no TrainingSession table exists) — without this guard, a
 * second org calling livekit-connect with the same string would silently be
 * handed a join token into the FIRST org's live room. Per
 * .claude/rules/tenancy.md, this must be rejected, not idempotently reused,
 * even though the room-creation call itself is otherwise idempotent.
 */
export class RoomOwnershipMismatchError extends Error {
  constructor(trainingSessionId: string) {
    super(`trainingSessionId "${trainingSessionId}" is already in use by another organization`);
    this.name = "RoomOwnershipMismatchError";
  }
}

interface KnownRoom {
  roomName: string;
  orgId: string;
}

/**
 * Which trainingSessionIds this process has minted a LiveKit room for, and
 * which org claimed each one first. In-memory only, like
 * ws-tickets.ts/rate-limit.ts — apps/api is single-process for now, and
 * there is no persisted TrainingSession/VoiceSession row anywhere in this
 * codebase to check ownership or "already ended" against (both dashboard
 * surfaces run off client-side fixtures/opaque route params, not a DB-backed
 * session model). A process restart forgets this map — a genuinely-ended
 * session becomes re-creatable, and a freed trainingSessionId's first-claim
 * ownership resets — an accepted limitation of this per-process store, same
 * class of tradeoff ws-tickets.ts already documents for itself.
 */
const knownRooms = new Map<string, KnownRoom>();

/** Test-only escape hatch — production code never needs to reset this. */
export function _resetKnownRoomsForTests(): void {
  knownRooms.clear();
}

/** Returns this org's known room for trainingSessionId, or null if none exists yet. Throws on cross-org collision. */
function getOwnKnownRoom(trainingSessionId: string, orgId: string): KnownRoom | null {
  const known = knownRooms.get(trainingSessionId);
  if (!known) return null;
  if (known.orgId !== orgId) throw new RoomOwnershipMismatchError(trainingSessionId);
  return known;
}

/**
 * True if `trainingSessionId` has never had a room (for this org), or its
 * room is still live. False only when a room was created for it before and
 * LiveKit no longer lists it (auto-deleted after its empty/departure
 * timeout) — the signal the livekit-connect route maps to 409 session_ended.
 * Throws RoomOwnershipMismatchError if trainingSessionId belongs to a
 * different org.
 */
export async function checkSessionNotEnded(
  trainingSessionId: string,
  orgId: string,
  env: NodeJS.ProcessEnv = process.env,
  createRoomServiceClient: CreateRoomServiceClient = defaultCreateRoomServiceClient,
): Promise<boolean> {
  const known = getOwnKnownRoom(trainingSessionId, orgId);
  if (!known) return true; // never started — not "ended"
  const { url, apiKey, apiSecret } = requireLiveKitEnv(env);
  const rooms = await createRoomServiceClient(toHttpHost(url), apiKey, apiSecret).listRooms([known.roomName]);
  return rooms.length > 0;
}

/**
 * Idempotent **per org**: repeated calls for the same (trainingSessionId,
 * orgId) pair return the same room name without erroring — LiveKit's own
 * createRoom is itself idempotent (re-creating an existing room just returns
 * it). A different org reusing the same trainingSessionId is NOT treated as
 * idempotent reuse — see RoomOwnershipMismatchError.
 *
 * Requests explicit dispatch via `agents` (not a separate AgentDispatchClient
 * call) — the worker fleet only ever receives jobs for rooms this route
 * intentionally created for a real Enterprise session, per
 * docs/ARCHITECTURE.md §4's cost-control boundary.
 */
export async function createLiveKitRoom(
  trainingSessionId: string,
  orgId: string,
  env: NodeJS.ProcessEnv = process.env,
  createRoomServiceClient: CreateRoomServiceClient = defaultCreateRoomServiceClient,
): Promise<{ roomName: string }> {
  const existing = getOwnKnownRoom(trainingSessionId, orgId); // throws on cross-org collision
  if (existing) return { roomName: existing.roomName };

  const { url, apiKey, apiSecret } = requireLiveKitEnv(env);
  const roomName = liveKitRoomName(trainingSessionId);

  // Reserved SYNCHRONOUSLY, before the network call below — this is the
  // fix for a real, empirically-confirmed TOCTOU race a security review
  // caught in an earlier version of this function: with the reservation
  // placed AFTER the `await createRoom(...)` call, two concurrent callers
  // for different orgs on the same trainingSessionId could both pass the
  // ownership check above (both see an empty map) before either one
  // reserved it, landing both orgs in the same live room. JS's
  // single-threaded event loop guarantees no other call can interleave
  // between the check above and this synchronous `.set()` — only the
  // `await` below can yield, and by then the slot is already claimed, so a
  // racing call for a different org now correctly throws
  // RoomOwnershipMismatchError instead of also succeeding. Rolled back on
  // failure so a failed create doesn't permanently squat the slot.
  knownRooms.set(trainingSessionId, { roomName, orgId });
  try {
    await createRoomServiceClient(toHttpHost(url), apiKey, apiSecret).createRoom({
      name: roomName,
      metadata: JSON.stringify({ orgId, trainingSessionId }),
      agents: [{ agentName: LIVEKIT_AGENT_NAME } as RoomAgentDispatch],
    });
  } catch (err) {
    const current = knownRooms.get(trainingSessionId);
    if (current && current.orgId === orgId && current.roomName === roomName) {
      knownRooms.delete(trainingSessionId);
    }
    throw err;
  }
  return { roomName };
}

const DEFAULT_TOKEN_TTL_SECONDS = 300;

type AccessTokenLike = Pick<AccessToken, "addGrant" | "toJwt">;

/** Injectable for tests; defaults to the real AccessToken constructor. */
export type CreateAccessToken = (
  apiKey: string,
  apiSecret: string,
  options: ConstructorParameters<typeof AccessToken>[2],
) => AccessTokenLike;

const defaultCreateAccessToken: CreateAccessToken = (apiKey, apiSecret, options) =>
  new AccessToken(apiKey, apiSecret, options);

/**
 * Mints a scoped join token for `roomName` — random opaque identity (never
 * learner/trainer PII), same primitive apps/api/src/lib/ws-tickets.ts
 * already uses for its own opaque tickets. Longer TTL than the WS ticket's
 * 60s (LIVEKIT_TOKEN_TTL_SECONDS, default 300s) to tolerate LiveKit connect
 * + agent-dispatch latency — no existing precedent in this repo sizes a
 * LiveKit-specific TTL, so this default is a documented assumption, tunable
 * via env without a code change.
 */
export async function mintLiveKitToken(
  params: { roomName: string; orgId: string },
  env: NodeJS.ProcessEnv = process.env,
  createAccessToken: CreateAccessToken = defaultCreateAccessToken,
): Promise<{ livekitUrl: string; roomToken: string }> {
  const { url, apiKey, apiSecret } = requireLiveKitEnv(env);
  const ttlSeconds = Number(env.LIVEKIT_TOKEN_TTL_SECONDS ?? DEFAULT_TOKEN_TTL_SECONDS);

  const token = createAccessToken(apiKey, apiSecret, {
    identity: generateOpaqueToken(),
    ttl: ttlSeconds,
    metadata: JSON.stringify({ orgId: params.orgId }),
  });
  token.addGrant({
    roomJoin: true,
    room: params.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return { livekitUrl: url, roomToken: await token.toJwt() };
}
