import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetKnownRoomsForTests,
  checkSessionNotEnded,
  createLiveKitRoom,
  isLiveKitConfigured,
  mintLiveKitToken,
  RoomOwnershipMismatchError,
  type CreateAccessToken,
  type CreateRoomServiceClient,
} from "./livekit.js";

const env = { LIVEKIT_URL: "wss://example.livekit.cloud", LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "secret" };

afterEach(() => {
  _resetKnownRoomsForTests();
});

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
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn(() => ({
      createRoom,
      listRooms: vi.fn(),
    }));

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
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn(() => ({ createRoom, listRooms: vi.fn() }));

    await createLiveKitRoom("s1", "org-1", { ...env, LIVEKIT_URL: "ws://localhost:7880" }, createRoomServiceClient);

    expect(createRoomServiceClient).toHaveBeenCalledWith("http://localhost:7880", "key", "secret");
  });

  it("throws when LiveKit env vars are missing, without calling the vendor SDK", async () => {
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn();
    await expect(createLiveKitRoom("s1", "org-1", {}, createRoomServiceClient)).rejects.toThrow(/LIVEKIT_URL/);
    expect(createRoomServiceClient).not.toHaveBeenCalled();
  });

  it("is idempotent for the SAME org: a second call returns the same room without re-calling createRoom", async () => {
    const createRoom = vi.fn().mockResolvedValue({});
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn(() => ({ createRoom, listRooms: vi.fn() }));

    const first = await createLiveKitRoom("s1", "org-1", env, createRoomServiceClient);
    const second = await createLiveKitRoom("s1", "org-1", env, createRoomServiceClient);

    expect(second).toEqual(first);
    expect(createRoom).toHaveBeenCalledTimes(1);
  });

  it("rejects a DIFFERENT org reusing the same trainingSessionId — never silently joins them into the first org's room", async () => {
    const createRoom = vi.fn().mockResolvedValue({});
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn(() => ({ createRoom, listRooms: vi.fn() }));

    await createLiveKitRoom("s1", "org-A", env, createRoomServiceClient);

    await expect(createLiveKitRoom("s1", "org-B", env, createRoomServiceClient)).rejects.toBeInstanceOf(
      RoomOwnershipMismatchError,
    );
    expect(createRoom).toHaveBeenCalledTimes(1); // never created a second time for org-B
  });

  it("rejects a concurrent DIFFERENT-org call racing against an in-flight createRoom network call (TOCTOU regression guard)", async () => {
    // Regression test for a real, security-reviewer-confirmed race: with the
    // ownership reservation placed AFTER the network call, two calls for
    // different orgs on the same trainingSessionId could both pass the
    // ownership check (both see an empty map) before either reserved it,
    // both succeeding into the same room. createRoom is given realistic
    // async latency here specifically to exercise that interleaving window
    // — a test that awaits org A to completion before starting org B (like
    // the sequential test above) would pass even with the race present.
    let resolveCreateRoom!: () => void;
    const createRoomGate = new Promise<void>((resolve) => (resolveCreateRoom = resolve));
    const createRoom = vi.fn().mockImplementation(() => createRoomGate.then(() => ({})));
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn(() => ({ createRoom, listRooms: vi.fn() }));

    const orgAPromise = createLiveKitRoom("shared-slug", "org-A", env, createRoomServiceClient);
    // Let org A's synchronous reservation run (it happens before the
    // `await createRoom(...)` inside createLiveKitRoom) — a microtask tick
    // is enough since the reservation itself has no await before it.
    await Promise.resolve();

    const orgBPromise = createLiveKitRoom("shared-slug", "org-B", env, createRoomServiceClient);

    resolveCreateRoom();
    const orgAResult = await orgAPromise;
    await expect(orgBPromise).rejects.toBeInstanceOf(RoomOwnershipMismatchError);

    expect(orgAResult).toEqual({ roomName: "ts_shared-slug" });
    expect(createRoom).toHaveBeenCalledTimes(1); // org B's call never reached the vendor SDK at all
  });
});

describe("checkSessionNotEnded", () => {
  it("is true for a trainingSessionId that never had a room", async () => {
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn();
    expect(await checkSessionNotEnded("never-started", "org-1", env, createRoomServiceClient)).toBe(true);
    expect(createRoomServiceClient).not.toHaveBeenCalled();
  });

  it("is true once a room has been created and LiveKit still lists it", async () => {
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn(() => ({
      createRoom: vi.fn().mockResolvedValue({}),
      listRooms: vi.fn().mockResolvedValue([{ name: "ts_s1" }]),
    }));

    await createLiveKitRoom("s1", "org-1", env, createRoomServiceClient);
    expect(await checkSessionNotEnded("s1", "org-1", env, createRoomServiceClient)).toBe(true);
  });

  it("is false once a room was created but LiveKit no longer lists it (auto-deleted after timeout)", async () => {
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn(() => ({
      createRoom: vi.fn().mockResolvedValue({}),
      listRooms: vi.fn().mockResolvedValue([]),
    }));

    await createLiveKitRoom("s1", "org-1", env, createRoomServiceClient);
    expect(await checkSessionNotEnded("s1", "org-1", env, createRoomServiceClient)).toBe(false);
  });

  it("rejects a DIFFERENT org checking a trainingSessionId owned by another org", async () => {
    const createRoomServiceClient: CreateRoomServiceClient = vi.fn(() => ({
      createRoom: vi.fn().mockResolvedValue({}),
      listRooms: vi.fn().mockResolvedValue([{ name: "ts_s1" }]),
    }));

    await createLiveKitRoom("s1", "org-A", env, createRoomServiceClient);

    await expect(checkSessionNotEnded("s1", "org-B", env, createRoomServiceClient)).rejects.toBeInstanceOf(
      RoomOwnershipMismatchError,
    );
  });
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
