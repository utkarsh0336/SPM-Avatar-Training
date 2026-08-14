import { describe, expect, it, vi } from "vitest";
import { createAvatarRelay } from "./avatar-relay.js";
import type { SimliBridge, SimliBridgeEvents, SimliConnectionInfo } from "./simli-bridge.js";

function createFakeBridge(): SimliBridge & { sendAudioCalls: Uint8Array[]; skipCalls: number; done: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  const sendAudioCalls: Uint8Array[] = [];
  let skipCalls = 0;
  return {
    sendAudioCalls,
    get skipCalls() {
      return skipCalls;
    },
    sendAudio: (audio: Uint8Array) => {
      sendAudioCalls.push(audio);
    },
    sendAudioImmediate: vi.fn(),
    skip: () => {
      skipCalls += 1;
    },
    done: vi.fn(),
    close: vi.fn(),
  } as unknown as SimliBridge & {
    sendAudioCalls: Uint8Array[];
    skipCalls: number;
    done: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}

const fakeParticipant = {} as never; // opaque — never touched by the testable core, only by the (unverified) default join fn

describe("createAvatarRelay", () => {
  it("connects the Simli bridge with the given credentials", async () => {
    const bridge = createFakeBridge();
    const connectSimliBridge = vi.fn().mockResolvedValue(bridge);

    await createAvatarRelay({
      simliApiKey: "k",
      simliFaceId: "f",
      ourLocalParticipant: fakeParticipant,
      connectSimliBridge,
      joinSimliRoomAndRepublish: vi.fn(),
    });

    expect(connectSimliBridge).toHaveBeenCalledWith(
      { apiKey: "k", faceId: "f", simliWsBaseUrl: undefined },
      expect.objectContaining({ onConnectionInfo: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("sendSentenceAudio forwards to the bridge — the only path TTS audio takes to Simli", async () => {
    const bridge = createFakeBridge();
    const connectSimliBridge = vi.fn().mockResolvedValue(bridge);

    const relay = await createAvatarRelay({
      simliApiKey: "k",
      simliFaceId: "f",
      ourLocalParticipant: fakeParticipant,
      connectSimliBridge,
      joinSimliRoomAndRepublish: vi.fn(),
    });

    const audio = new Uint8Array([1, 2, 3]);
    relay.sendSentenceAudio(audio);
    expect(bridge.sendAudioCalls).toEqual([audio]);
  });

  it("skip() calls the bridge's skip() exactly once per call — the barge-in signal", async () => {
    const bridge = createFakeBridge();
    const connectSimliBridge = vi.fn().mockResolvedValue(bridge);

    const relay = await createAvatarRelay({
      simliApiKey: "k",
      simliFaceId: "f",
      ourLocalParticipant: fakeParticipant,
      connectSimliBridge,
      joinSimliRoomAndRepublish: vi.fn(),
    });

    relay.skip();
    relay.skip();
    expect(bridge.skipCalls).toBe(2);
  });

  it("calls the join function once a connection-info frame arrives, passing our local participant through", async () => {
    let capturedEvents!: SimliBridgeEvents;
    const bridge = createFakeBridge();
    const connectSimliBridge = vi.fn((_opts: unknown, events: SimliBridgeEvents = {}) => {
      capturedEvents = events;
      return Promise.resolve(bridge);
    });
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const joinSimliRoomAndRepublish = vi.fn().mockResolvedValue(cleanup);

    await createAvatarRelay({
      simliApiKey: "k",
      simliFaceId: "f",
      ourLocalParticipant: fakeParticipant,
      connectSimliBridge,
      joinSimliRoomAndRepublish,
    });

    const info: SimliConnectionInfo = { livekitUrl: "wss://simli-room.example", livekitToken: "jwt" };
    capturedEvents.onConnectionInfo?.(info);
    await vi.waitFor(() => expect(joinSimliRoomAndRepublish).toHaveBeenCalledWith(info, fakeParticipant));
  });

  it("stop() sends DONE, closes the bridge, and runs the republish cleanup if the relay had connected", async () => {
    let capturedEvents!: SimliBridgeEvents;
    const bridge = createFakeBridge();
    const connectSimliBridge = vi.fn((_opts: unknown, events: SimliBridgeEvents = {}) => {
      capturedEvents = events;
      return Promise.resolve(bridge);
    });
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const joinSimliRoomAndRepublish = vi.fn().mockResolvedValue(cleanup);

    const relay = await createAvatarRelay({
      simliApiKey: "k",
      simliFaceId: "f",
      ourLocalParticipant: fakeParticipant,
      connectSimliBridge,
      joinSimliRoomAndRepublish,
    });

    capturedEvents.onConnectionInfo?.({ livekitUrl: "wss://x", livekitToken: "jwt" });
    await vi.waitFor(() => expect(joinSimliRoomAndRepublish).toHaveBeenCalled());

    await relay.stop();

    expect(bridge.done).toHaveBeenCalled();
    expect(bridge.close).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalled();
  });

  it("stop() before the relay ever connects still sends DONE/close, without throwing on a null cleanup", async () => {
    const bridge = createFakeBridge();
    const connectSimliBridge = vi.fn().mockResolvedValue(bridge);

    const relay = await createAvatarRelay({
      simliApiKey: "k",
      simliFaceId: "f",
      ourLocalParticipant: fakeParticipant,
      connectSimliBridge,
      joinSimliRoomAndRepublish: vi.fn(),
    });

    await expect(relay.stop()).resolves.not.toThrow();
    expect(bridge.done).toHaveBeenCalled();
    expect(bridge.close).toHaveBeenCalled();
  });

  it("is a no-op to call sendSentenceAudio/skip after stop()", async () => {
    const bridge = createFakeBridge();
    const connectSimliBridge = vi.fn().mockResolvedValue(bridge);

    const relay = await createAvatarRelay({
      simliApiKey: "k",
      simliFaceId: "f",
      ourLocalParticipant: fakeParticipant,
      connectSimliBridge,
      joinSimliRoomAndRepublish: vi.fn(),
    });

    await relay.stop();
    relay.sendSentenceAudio(new Uint8Array([9]));
    relay.skip();

    expect(bridge.sendAudioCalls).toEqual([]);
    expect(bridge.skipCalls).toBe(0);
  });

  it("forwards the bridge's onError to the relay's own onError", async () => {
    let capturedEvents!: SimliBridgeEvents;
    const bridge = createFakeBridge();
    const connectSimliBridge = vi.fn((_opts: unknown, events: SimliBridgeEvents = {}) => {
      capturedEvents = events;
      return Promise.resolve(bridge);
    });
    const onError = vi.fn();

    await createAvatarRelay({
      simliApiKey: "k",
      simliFaceId: "f",
      ourLocalParticipant: fakeParticipant,
      connectSimliBridge,
      joinSimliRoomAndRepublish: vi.fn(),
      onError,
    });

    capturedEvents.onError?.("something broke");
    expect(onError).toHaveBeenCalledWith("something broke");
  });
});
