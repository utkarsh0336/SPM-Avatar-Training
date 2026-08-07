import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectConversationSession, type ConversationAvatarSink, type SessionStartConfig } from "./conversation-session.js";

class FakeWebSocket {
  readyState = 0;
  sent: unknown[] = [];
  private listeners: Record<string, ((event: never) => void)[]> = {};

  addEventListener(event: string, cb: (event: never) => void): void {
    this.listeners[event] = [...(this.listeners[event] ?? []), cb];
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
    this.emit("close", {} as never);
  }
  open(): void {
    this.readyState = 1;
    this.emit("open", {} as never);
  }
  emit(event: string, payload: never): void {
    this.listeners[event]?.forEach((cb) => cb(payload));
  }
  emitMessage(data: unknown): void {
    this.emit("message", { data: JSON.stringify(data) } as never);
  }
}

class FakeMediaRecorder {
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  start(): void {}
  stop(): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) });
    this.onstop?.();
  }
}

function createFakeAudioContext(amplitude: { value: number }): AudioContext {
  const fakeAudioBuffer = {
    sampleRate: 44100,
    length: 4,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(4),
  };
  return {
    decodeAudioData: vi.fn().mockResolvedValue(fakeAudioBuffer),
    createMediaStreamDestination: vi.fn(() => ({
      stream: { getAudioTracks: () => [{} as MediaStreamTrack] },
    })),
    createBufferSource: vi.fn(() => {
      const node = {
        connect: vi.fn(),
        onended: null as (() => void) | null,
        start: vi.fn(function (this: { onended: (() => void) | null }) {
          queueMicrotask(() => this.onended?.());
        }),
      };
      return node;
    }),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    createAnalyser: vi.fn(() => ({
      fftSize: 0,
      frequencyBinCount: 4,
      getByteTimeDomainData: (arr: Uint8Array) => arr.fill(amplitude.value),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as AudioContext;
}

function createFakeRaf() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const raf = vi.fn((cb: () => void) => {
    const handle = nextHandle++;
    pending.set(handle, cb);
    return handle;
  });
  const tick = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((cb) => cb());
  };
  return { raf, tick };
}

function createFakeAvatar(): ConversationAvatarSink & { speakCalls: string[]; interrupt: ReturnType<typeof vi.fn> } {
  const speakCalls: string[] = [];
  return {
    speakCalls,
    speak: (_track, text) => {
      speakCalls.push(text);
    },
    interrupt: vi.fn(),
  };
}

const sessionConfig: SessionStartConfig = {
  avatarName: "Nancy",
  expertise: "HR_LEAVE_POLICY",
  voiceTone: "WARM",
  style: "REALISTIC",
  gender: "FEMALE",
  outfit: "BUSINESS_FORMAL",
  topic: "HR & Leave Policy",
};

function setupHarness() {
  const ws = new FakeWebSocket();
  const amplitude = { value: 128 }; // 128 = silence (RMS 0)
  const audioContext = createFakeAudioContext(amplitude);
  const raf = createFakeRaf();
  const avatar = createFakeAvatar();
  const onStatusChange = vi.fn();
  const onTranscript = vi.fn();
  const onLatency = vi.fn();
  const onError = vi.fn();

  const connectPromise = connectConversationSession({
    wsUrl: "wss://example.test/v1/conversations/s1/ws?ticket=abc",
    micTrack: {} as MediaStreamTrack,
    avatar,
    sessionConfig,
    onStatusChange,
    onTranscript,
    onLatency,
    onError,
    createWebSocket: () => ws as unknown as WebSocket,
    createMediaRecorder: () => new FakeMediaRecorder() as unknown as MediaRecorder,
    createAudioContext: () => audioContext,
    requestAnimationFrame: raf.raf,
  });

  ws.open();

  return { ws, audioContext, raf, avatar, onStatusChange, onTranscript, onLatency, onError, connectPromise, amplitude };
}

describe("connectConversationSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // MediaStream is a browser-only global not present under Node's vitest
    // environment — both this module and voice-activity-detector.ts wrap
    // the mic track in one, so it needs to exist. Same stub as
    // voice-activity-detector.test.ts uses.
    vi.stubGlobal(
      "MediaStream",
      class {
        tracks: unknown[];
        constructor(tracks: unknown[]) {
          this.tracks = tracks;
        }
      },
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends session.start with the given config once the socket opens", async () => {
    const { connectPromise, ws } = setupHarness();
    await connectPromise;
    expect(ws.sent).toEqual([{ type: "session.start", ...sessionConfig }]);
  });

  it("moves to listening once the server confirms session.ready", async () => {
    const { connectPromise, ws, onStatusChange } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "session.ready" });
    expect(onStatusChange).toHaveBeenCalledWith("listening");
  });

  it("forwards transcript messages for both roles", async () => {
    const { connectPromise, ws, onTranscript } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "transcript", role: "user", text: "hi", utteranceId: "u1", final: true });
    ws.emitMessage({ type: "transcript", role: "avatar", text: "hello", utteranceId: "u1", final: true });
    expect(onTranscript).toHaveBeenNthCalledWith(1, { utteranceId: "u1", role: "user", text: "hi", final: true });
    expect(onTranscript).toHaveBeenNthCalledWith(2, {
      utteranceId: "u1",
      role: "avatar",
      text: "hello",
      final: true,
    });
  });

  it("plays tts.chunk messages through the avatar in order, sequentially", async () => {
    const { connectPromise, ws, avatar } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "turn.started", utteranceId: "u1" });
    ws.emitMessage({
      type: "tts.chunk",
      utteranceId: "u1",
      sentenceIndex: 0,
      text: "First.",
      audioBase64: "AAAA",
      mimeType: "audio/wav",
      isLastForUtterance: false,
    });
    ws.emitMessage({
      type: "tts.chunk",
      utteranceId: "u1",
      sentenceIndex: 1,
      text: "Second.",
      audioBase64: "AAAA",
      mimeType: "audio/wav",
      isLastForUtterance: true,
    });

    // Let the microtask-driven playback chain (decode -> speak -> onEnded) settle.
    await vi.runAllTimersAsync();

    expect(avatar.speakCalls).toEqual(["First.", "Second."]);
  });

  it("drops queued tts.chunk audio for a turn that has since been cancelled", async () => {
    const { connectPromise, ws, avatar } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "turn.started", utteranceId: "u1" });
    ws.emitMessage({
      type: "tts.chunk",
      utteranceId: "u1",
      sentenceIndex: 0,
      text: "Should not play.",
      audioBase64: "AAAA",
      mimeType: "audio/wav",
      isLastForUtterance: true,
    });
    ws.emitMessage({ type: "turn.cancelled", utteranceId: "u1" });

    await vi.runAllTimersAsync();

    expect(avatar.speakCalls).toEqual([]);
  });

  it("barge-in: VAD speech-start while speaking interrupts the avatar and notifies the server", async () => {
    const { connectPromise, ws, avatar, amplitude, raf } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "turn.started", utteranceId: "u1" });

    // Simulate the user starting to talk: loud audio for long enough to
    // cross VAD's minSpeechDurationMs (300ms default).
    vi.setSystemTime(0);
    amplitude.value = 200; // well above the default 0.02 RMS threshold
    raf.tick();
    vi.setSystemTime(350);
    raf.tick();

    expect(avatar.interrupt).toHaveBeenCalled();
    expect(ws.sent).toContainEqual({ type: "barge_in", utteranceId: "u1" });
  });

  it("switches to the Web Speech fallback after the server reports stt.failed", async () => {
    const recognizeOnce = vi.fn().mockResolvedValue({ text: "recognized text" });
    const ws = new FakeWebSocket();
    const amplitude = { value: 128 };
    const audioContext = createFakeAudioContext(amplitude);
    const raf = createFakeRaf();
    const avatar = createFakeAvatar();

    const connectPromise = connectConversationSession({
      wsUrl: "wss://example.test/ws",
      micTrack: {} as MediaStreamTrack,
      avatar,
      sessionConfig,
      onStatusChange: vi.fn(),
      createWebSocket: () => ws as unknown as WebSocket,
      createMediaRecorder: () => new FakeMediaRecorder() as unknown as MediaRecorder,
      createAudioContext: () => audioContext,
      requestAnimationFrame: raf.raf,
      recognizeOnce,
    });
    ws.open();
    await connectPromise;

    ws.emitMessage({ type: "stt.failed", utteranceId: "u0", retryable: false });

    // Drive one full speech start -> speech end cycle through real VAD timing.
    vi.setSystemTime(0);
    amplitude.value = 200;
    raf.tick();
    vi.setSystemTime(400);
    amplitude.value = 128; // silence begins
    raf.tick();
    vi.setSystemTime(1200); // past minSpeechDurationMs(300) + silenceDurationMs(700)
    raf.tick();

    await vi.runAllTimersAsync();

    expect(recognizeOnce).toHaveBeenCalled();
    const fallbackMessage = ws.sent.find(
      (m): m is { type: "text.fallback"; text: string } =>
        typeof m === "object" && m !== null && "type" in m && m.type === "text.fallback",
    );
    expect(fallbackMessage?.text).toBe("recognized text");
  });

  it("surfaces turn.failed as an error and returns to listening", async () => {
    const { connectPromise, ws, onError, onStatusChange } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "turn.started", utteranceId: "u1" });
    ws.emitMessage({ type: "turn.failed", utteranceId: "u1", kind: "llm", message: "All LLM providers failed" });

    expect(onError).toHaveBeenCalledWith("All LLM providers failed");
    expect(onStatusChange).toHaveBeenCalledWith("listening");
  });

  it("forwards latency events", async () => {
    const { connectPromise, ws, onLatency } = setupHarness();
    await connectPromise;
    ws.emitMessage({
      type: "latency",
      utteranceId: "u1",
      totalMs: 950,
      servedBy: { llm: "gemini", stt: "groq-whisper", tts: "echogarden" },
    });
    expect(onLatency).toHaveBeenCalledWith({
      utteranceId: "u1",
      sttMs: undefined,
      llmFirstTokenMs: undefined,
      ttsFirstChunkMs: undefined,
      totalMs: 950,
      servedBy: { llm: "gemini", stt: "groq-whisper", tts: "echogarden" },
    });
  });

  it("disconnect() sends session.end, closes the socket, and reports ended", async () => {
    const { connectPromise, ws, onStatusChange } = setupHarness();
    const handle = await connectPromise;

    handle.disconnect();

    expect(ws.sent).toContainEqual({ type: "session.end" });
    expect(ws.readyState).toBe(3);
    expect(onStatusChange).toHaveBeenCalledWith("ended");
  });

  it("ignores a malformed server message instead of throwing", async () => {
    const { connectPromise, ws } = setupHarness();
    await connectPromise;
    expect(() => ws.emitMessage({ type: "not.a.real.type" })).not.toThrow();
  });
});
