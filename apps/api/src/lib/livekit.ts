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

type RoomServiceClientLike = Pick<RoomServiceClient, "createRoom">;

/** Injectable for tests; defaults to the real RoomServiceClient constructor. */
export type CreateRoomServiceClient = (host: string, apiKey: string, apiSecret: string) => RoomServiceClientLike;

const defaultCreateRoomServiceClient: CreateRoomServiceClient = (host, apiKey, apiSecret) =>
  new RoomServiceClient(host, apiKey, apiSecret);

/**
 * Idempotent: LiveKit's own createRoom is itself idempotent (re-creating an
 * existing room just returns it). No in-memory ownership/ended-state
 * tracking is needed here anymore — trainingSessionId is now a server-minted,
 * RLS-scoped TrainingSession.id (see .claude/specs/video-chat-session.md,
 * Milestone 2); a second org structurally cannot even address another org's
 * id (RLS returns nothing → 404 before this function is ever called), and
 * "already ended" is the real TrainingSession.status column
 * (training-session-service.ts's getTrainingSessionForConnect), not an
 * inference from whether LiveKit still lists the room. This used to be
 * guarded by an in-memory Map + a hand-rolled TOCTOU-safe reservation dance
 * (see git history) — that entire class of bug is now unreachable by
 * construction, not just patched.
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
  const { url, apiKey, apiSecret } = requireLiveKitEnv(env);
  const roomName = liveKitRoomName(trainingSessionId);

  await createRoomServiceClient(toHttpHost(url), apiKey, apiSecret).createRoom({
    name: roomName,
    metadata: JSON.stringify({ orgId, trainingSessionId }),
    agents: [{ agentName: LIVEKIT_AGENT_NAME } as RoomAgentDispatch],
  });
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
