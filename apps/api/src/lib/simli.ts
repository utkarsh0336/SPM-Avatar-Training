import { generateIceServers, generateSimliSessionToken } from "simli-client";

/**
 * Simli is a PAID API — not in .claude/specs/ai-avatar.md's $0/month
 * approved stack. It is only ever called when both SIMLI_API_KEY and
 * SIMLI_FACE_ID are explicitly configured (opt-in, same posture as the
 * Tavus/HeyGen adapters: write it, gate it, never call it by default). The
 * raw API key never leaves this process — only the short-lived
 * `session_token` and the ICE servers this mints reach the browser. See
 * .claude/specs/avatar-builder-customization.md.
 */
export function isSimliConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SIMLI_API_KEY && env.SIMLI_FACE_ID);
}

export type SimliGender = "FEMALE" | "MALE" | "NEUTRAL";

const GENDER_FACE_ID_ENV_VAR: Record<SimliGender, string> = {
  FEMALE: "SIMLI_FACE_ID_FEMALE",
  MALE: "SIMLI_FACE_ID_MALE",
  NEUTRAL: "SIMLI_FACE_ID_NEUTRAL",
};

/**
 * Resolves which real Simli face an Avatar with the given gender should
 * use. Falls back to the base SIMLI_FACE_ID when no gender-specific
 * override is configured (e.g. only SIMLI_FACE_ID_MALE/NEUTRAL were ever
 * added — Female keeps using the original single face rather than being
 * left with no face at all). Returns null when gender is null (not yet
 * chosen) or Simli isn't configured — callers treat null exactly like any
 * other not-yet-set Avatar field.
 */
export function resolveSimliFaceId(
  gender: SimliGender | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!isSimliConfigured(env)) return null;
  const genderSpecific = gender ? env[GENDER_FACE_ID_ENV_VAR[gender]] : undefined;
  return genderSpecific ?? env.SIMLI_FACE_ID ?? null;
}

// Derived structurally rather than naming the DOM lib's RTCIceServer type
// directly — apps/api's tsconfig has no "dom" lib (a Node/Fastify server
// project correctly excludes browser globals), so that name isn't
// resolvable here even though simli-client's own .d.ts assumes it is.
export type SimliIceServer = Awaited<ReturnType<typeof generateIceServers>>[number];

export interface SimliSession {
  sessionToken: string;
  iceServers: SimliIceServer[];
}

export interface MintSimliSessionOptions {
  env?: NodeJS.ProcessEnv;
  /**
   * Overrides env.SIMLI_FACE_ID — used to pin a session to a specific
   * Avatar's persisted face (see routes/conversations.ts, which resolves
   * this from the caller's own authenticated Avatar record, never from
   * client input). Falls back to env.SIMLI_FACE_ID when omitted or null
   * (e.g. an Avatar created before Simli was configured has no face of its
   * own yet).
   */
  faceId?: string | null;
  /** Injectable for tests. */
  generateToken?: typeof generateSimliSessionToken;
  generateIce?: typeof generateIceServers;
}

/**
 * Mints both the session_token and the ICE servers a browser SimliClient
 * needs for its default P2P WebRTC transport — omitting iceServers makes
 * SimliClient throw "Ice Servers Required for P2P Mode" (confirmed against
 * a live session during manual verification), so both must travel together.
 */
export async function mintSimliSession(options: MintSimliSessionOptions = {}): Promise<SimliSession> {
  const env = options.env ?? process.env;
  const apiKey = env.SIMLI_API_KEY;
  const faceId = options.faceId ?? env.SIMLI_FACE_ID;
  if (!apiKey || !faceId) {
    throw new Error(
      "SIMLI_API_KEY and SIMLI_FACE_ID must both be set to mint a Simli session — see .env.example.",
    );
  }

  const maxSessionLength = Number(env.SIMLI_MAX_SESSION_SECONDS ?? 600);
  const maxIdleTime = Number(env.SIMLI_MAX_IDLE_SECONDS ?? 60);

  const generateToken = options.generateToken ?? generateSimliSessionToken;
  const generateIce = options.generateIce ?? generateIceServers;

  const [{ session_token }, iceServers] = await Promise.all([
    generateToken({
      apiKey,
      config: { faceId, handleSilence: true, maxSessionLength, maxIdleTime },
    }),
    generateIce(apiKey),
  ]);

  return { sessionToken: session_token, iceServers };
}
