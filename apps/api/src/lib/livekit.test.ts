import { describe, expect, it, vi } from "vitest";
import {
  createLiveKitRoom,
  isLiveKitConfigured,
  mintLiveKitToken,
  type CreateAccessToken,
  type CreateRoomServiceClient,
} from "./livekit.js";

const env = { LIVEKIT_URL: "wss://example.livekit.cloud", LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "secret" };

describe("isLiveKitConfigured", () => {
  it("is false when any var is missing", () => {
    expect(isLiveKitConfigured({})).toBe(false);
    expect(isLiveKitConfigured({ LIVEKIT_URL: "wss://x" })).toBe(false);
    expect(isLiveKitConfigured({ LIVEKIT_URL: "wss://x", LIVEKIT_API_KEY: "k" })).toBe(false);
  });

  it("is true when all three are set", () => {
    expect(isLiveKitConfigured(env)).toBe(true);
  });
});

describe("createLiveKitRoom", () => {
  it("creates a room named from the training session id, requesting explicit agent dispatch", async () => {
    const createRoom = vi.fn().mockResolvedValue({});
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn(() => ({ createRoom }));

    const { roomName } = await createLiveKitRoom("sales-pitch-practice", "org-1", env, createRoomServiceClient);

    expect(roomName).toBe("ts_sales-pitch-practice");
    expect(createRoomServiceClient).toHaveBeenCalledWith("https://example.livekit.cloud", "key", "secret");
    expect(createRoom).toHaveBeenCalledWith({
      name: "ts_sales-pitch-practice",
      metadata: JSON.stringify({ orgId: "org-1", trainingSessionId: "sales-pitch-practice" }),
      agents: [{ agentName: "avatrain-livekit-agent" }],
    });
  });

  it("converts a plain ws:// LiveKit URL to http:// for the RPC client host", async () => {
    const createRoom = vi.fn().mockResolvedValue({});
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn(() => ({ createRoom }));

    await createLiveKitRoom("s1", "org-1", { ...env, LIVEKIT_URL: "ws://localhost:7880" }, createRoomServiceClient);

    expect(createRoomServiceClient).toHaveBeenCalledWith("http://localhost:7880", "key", "secret");
  });

  it("throws when LiveKit env vars are missing, without calling the vendor SDK", async () => {
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn();
    await expect(createLiveKitRoom("s1", "org-1", {}, createRoomServiceClient)).rejects.toThrow(/LIVEKIT_URL/);
    expect(createRoomServiceClient).not.toHaveBeenCalled();
  });

  it("is idempotent: repeated calls for the same trainingSessionId both call createRoom, which LiveKit itself treats idempotently", async () => {
    const createRoom = vi.fn().mockResolvedValue({});
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn(() => ({ createRoom }));

    const first = await createLiveKitRoom("s1", "org-1", env, createRoomServiceClient);
    const second = await createLiveKitRoom("s1", "org-1", env, createRoomServiceClient);

    expect(second).toEqual(first);
    expect(createRoom).toHaveBeenCalledTimes(2); // no in-memory reservation cache anymore — LiveKit's createRoom is the idempotency boundary
  });

  // Cross-org ownership races (two orgs racing to claim the same trainingSessionId) are no longer
  // possible to even construct: trainingSessionId is now a server-minted, RLS-scoped
  // TrainingSession.id — a second org cannot address another org's id at all (RLS returns nothing
  // → 404 in apps/api/src/routes/conversations.ts, before this function is ever reached). The
  // in-memory reservation/TOCTOU-race regression tests that used to live here were guarding
  // against the old client-generated-slug identity scheme; that class of bug is unreachable by
  // construction now, not just re-tested.
});

describe("mintLiveKitToken", () => {
  it("mints a token scoped to exactly the given room with publish/subscribe/data grants", async () => {
    const addGrant = vi.fn();
    const toJwt = vi.fn().mockResolvedValue("signed.jwt.token");
    const createAccessToken: CreateAccessToken = vi.fn(() => ({ addGrant, toJwt }));

    const result = await mintLiveKitToken({ roomName: "ts_s1", orgId: "org-1" }, env, createAccessToken);

    expect(result).toEqual({ livekitUrl: "wss://example.livekit.cloud", roomToken: "signed.jwt.token" });
    expect(addGrant).toHaveBeenCalledWith({
      roomJoin: true,
      room: "ts_s1",
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
  });

  it("never passes org/learner PII as the token identity — an opaque value only", async () => {
    const addGrant = vi.fn();
    const toJwt = vi.fn().mockResolvedValue("jwt");
    let capturedOptions: unknown;
    const createAccessToken: CreateAccessToken = vi.fn((_key, _secret, options) => {
      capturedOptions = options;
      return { addGrant, toJwt };
    });

    await mintLiveKitToken({ roomName: "ts_s1", orgId: "org-1" }, env, createAccessToken);

    const identity = (capturedOptions as { identity?: string }).identity;
    expect(identity).toBeDefined();
    expect(identity).not.toContain("org-1");
  });

  it("defaults the token TTL to 300s and honors LIVEKIT_TOKEN_TTL_SECONDS when set", async () => {
    const createAccessToken: CreateAccessToken = vi.fn(() => ({ addGrant: vi.fn(), toJwt: vi.fn().mockResolvedValue("jwt") }));

    await mintLiveKitToken({ roomName: "ts_s1", orgId: "org-1" }, env, createAccessToken);
    expect((createAccessToken as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toMatchObject({ ttl: 300 });

    await mintLiveKitToken(
      { roomName: "ts_s1", orgId: "org-1" },
      { ...env, LIVEKIT_TOKEN_TTL_SECONDS: "120" },
      createAccessToken,
    );
    expect((createAccessToken as ReturnType<typeof vi.fn>).mock.calls[1]![2]).toMatchObject({ ttl: 120 });
  });

  it("throws when LiveKit env vars are missing, without calling the vendor SDK", async () => {
    const createAccessToken: CreateAccessToken = vi.fn();
    await expect(mintLiveKitToken({ roomName: "ts_s1", orgId: "org-1" }, {}, createAccessToken)).rejects.toThrow(
      /LIVEKIT_URL/,
    );
    expect(createAccessToken).not.toHaveBeenCalled();
  });
});
