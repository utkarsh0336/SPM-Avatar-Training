import { describe, expect, it, vi } from "vitest";
import { connectSimliBridge, type SimliBridge, type SimliBridgeEvents, type WebSocketLike } from "./simli-bridge.js";

function createFakeWebSocket(): WebSocketLike & {
  sent: (string | Uint8Array)[];
  emitOpen: () => void;
  emitMessage: (data: unknown) => void;
  emitError: (err: unknown) => void;
  closed: boolean;
} {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const sent: (string | Uint8Array)[] = [];
  const socket = {
    sent,
    closed: false,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      (listeners[event] ??= []).push(listener);
    },
    send: (data: string | Uint8Array) => {
      sent.push(data);
    },
    close: () => {
      socket.closed = true;
    },
    emitOpen: () => listeners.open?.forEach((l) => l()),
    emitMessage: (data: unknown) => listeners.message?.forEach((l) => l(data)),
    emitError: (err: unknown) => listeners.error?.forEach((l) => l(err)),
  };
  return socket as unknown as WebSocketLike & {
    sent: (string | Uint8Array)[];
    emitOpen: () => void;
    emitMessage: (data: unknown) => void;
    emitError: (err: unknown) => void;
    closed: boolean;
  };
}

const baseOptions = { apiKey: "k", faceId: "f" };

function fakeGenerateToken(token = "tok_abc") {
  return vi.fn().mockResolvedValue({ session_token: token });
}

/**
 * connectSimliBridge awaits generateToken() (a real microtask hop) before
 * ever calling createWebSocket()/registering the "open" listener — a
 * synchronous ws.emitOpen() called right after invoking connectSimliBridge
 * fires before that listener exists and is lost forever. Flushing via
 * setImmediate (a macrotask) guarantees every microtask queued before it —
 * including generateToken's resolution and the ws.on("open", ...) call that
 * follows it — has already run.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

type Overrides = { createWebSocket?: (url: string) => WebSocketLike; generateToken?: ReturnType<typeof fakeGenerateToken> };

async function connectAndOpen(
  overrides: Overrides = {},
  events: SimliBridgeEvents = {},
): Promise<{ ws: ReturnType<typeof createFakeWebSocket>; bridge: SimliBridge; createWebSocket: ReturnType<typeof vi.fn> }> {
  const ws = createFakeWebSocket();
  const createWebSocket = overrides.createWebSocket ? vi.fn(overrides.createWebSocket) : vi.fn(() => ws);
  const generateToken = overrides.generateToken ?? fakeGenerateToken();

  const connectPromise = connectSimliBridge({ ...baseOptions, createWebSocket, generateToken }, events);
  await flushMicrotasks();
  ws.emitOpen();
  const bridge = await connectPromise;
  return { ws, bridge, createWebSocket };
}

describe("connectSimliBridge", () => {
  it("mints a session token and opens a WS to the LiveKit-backed endpoint with it as a query param", async () => {
    const generateToken = fakeGenerateToken("tok_xyz");
    const { createWebSocket } = await connectAndOpen({ generateToken });

    expect(generateToken).toHaveBeenCalledWith({
      apiKey: "k",
      config: { faceId: "f", handleSilence: true, maxSessionLength: 600, maxIdleTime: 60 },
    });
    expect(createWebSocket).toHaveBeenCalledWith("wss://api.simli.ai/compose/webrtc/livekit?session_token=tok_xyz");
  });

  it("rejects the connect promise if the socket errors before opening", async () => {
    const ws = createFakeWebSocket();
    const createWebSocket = vi.fn(() => ws);
    const connectPromise = connectSimliBridge({ ...baseOptions, createWebSocket, generateToken: fakeGenerateToken() });

    await flushMicrotasks();
    ws.emitError(new Error("connect failed"));

    await expect(connectPromise).rejects.toThrow("connect failed");
  });

  it("sendAudio sends the raw bytes as a binary frame, no prefix", async () => {
    const { ws, bridge } = await connectAndOpen();
    const audio = new Uint8Array([1, 2, 3]);
    bridge.sendAudio(audio);
    expect(ws.sent).toEqual([audio]);
  });

  it("sendAudioImmediate prefixes the bytes with PLAY_IMMEDIATE", async () => {
    const { ws, bridge } = await connectAndOpen();
    bridge.sendAudioImmediate(new Uint8Array([9, 9]));
    const sentFrame = ws.sent[0] as Uint8Array;
    const decoded = new TextDecoder().decode(sentFrame.slice(0, 14));
    expect(decoded).toBe("PLAY_IMMEDIATE");
    expect(Array.from(sentFrame.slice(14))).toEqual([9, 9]);
  });

  it("skip() and done() send the literal SKIP/DONE text signals", async () => {
    const { ws, bridge } = await connectAndOpen();
    bridge.skip();
    bridge.done();
    expect(ws.sent).toEqual(["SKIP", "DONE"]);
  });

  it("close() closes the underlying socket", async () => {
    const { ws, bridge } = await connectAndOpen();
    bridge.close();
    expect(ws.closed).toBe(true);
  });

  describe("incoming frame parsing", () => {
    it("fires onAck for an ACK frame", async () => {
      const onAck = vi.fn();
      const { ws } = await connectAndOpen({}, { onAck });
      ws.emitMessage("ACK");
      expect(onAck).toHaveBeenCalled();
    });

    it("fires onSpeaking / onSilent for SPEAK / SILENT frames", async () => {
      const onSpeaking = vi.fn();
      const onSilent = vi.fn();
      const { ws } = await connectAndOpen({}, { onSpeaking, onSilent });
      ws.emitMessage("SPEAK");
      ws.emitMessage("SILENT");
      expect(onSpeaking).toHaveBeenCalled();
      expect(onSilent).toHaveBeenCalled();
    });

    it("fires onStop for a STOP frame, distinct from onError", async () => {
      const onStop = vi.fn();
      const onError = vi.fn();
      const { ws } = await connectAndOpen({}, { onStop, onError });
      ws.emitMessage("STOP");
      expect(onStop).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it("fires onError (not onSpeaking) for ERROR/RATE/CLOSING frames — no fallthrough bug", async () => {
      const onError = vi.fn();
      const onSpeaking = vi.fn();
      const { ws } = await connectAndOpen({}, { onError, onSpeaking });
      ws.emitMessage("ERROR: something broke");
      ws.emitMessage("RATE limited");
      ws.emitMessage("CLOSING now");
      expect(onError).toHaveBeenCalledTimes(3);
      expect(onSpeaking).not.toHaveBeenCalled();
    });

    it("fires onConnectionInfo with camelCased fields for a LIVEKIT connection-info frame", async () => {
      const onConnectionInfo = vi.fn();
      const { ws } = await connectAndOpen({}, { onConnectionInfo });
      ws.emitMessage(JSON.stringify({ livekit_url: "wss://simli-room.example", livekit_token: "jwt-abc" }));
      expect(onConnectionInfo).toHaveBeenCalledWith({ livekitUrl: "wss://simli-room.example", livekitToken: "jwt-abc" });
    });

    it("ignores an unrecognized text frame without throwing", async () => {
      const { ws } = await connectAndOpen({}, {});
      expect(() => ws.emitMessage("VIDEO_METADATA {}")).not.toThrow();
      expect(() => ws.emitMessage("something totally unknown")).not.toThrow();
    });

    it("routes an unexpected binary reply through onError instead of silently dropping it", async () => {
      const onError = vi.fn();
      const { ws } = await connectAndOpen({}, { onError });
      ws.emitMessage(Buffer.from([1, 2, 3]));
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("binary"));
    });
  });
});
