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

function createFakeAudioContext(
  amplitude: { value: number },
  // Sample value decodeAudioData's fake AudioBuffer is filled with — loud
  // (0.5) by default so the RMS gate in stopRecordingAndSend() doesn't
  // reject every existing test's recorded "turn" by default. Tests that
  // specifically exercise the low-energy-drop path override this to ~0.
  decodedSample = 0.5,
): AudioContext {
  const fakeAudioBuffer = {
    sampleRate: 44100,
    length: 4,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(4).fill(decodedSample),
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

function createFakeAvatar(): ConversationAvatarSink & {
  speakCalls: string[];
  interrupt: ReturnType<typeof vi.fn>;
  setEmotion: ReturnType<typeof vi.fn>;
  setPhase: ReturnType<typeof vi.fn>;
} {
  const speakCalls: string[] = [];
  return {
    speakCalls,
    speak: (_track, text) => {
      speakCalls.push(text);
    },
    interrupt: vi.fn(),
    setEmotion: vi.fn(),
    setPhase: vi.fn(),
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
  language: "English",
};

function setupHarness(decodedSample?: number) {
  const ws = new FakeWebSocket();
  const amplitude = { value: 128 }; // 128 = silence (RMS 0)
  const audioContext = createFakeAudioContext(amplitude, decodedSample);
  const raf = createFakeRaf();
  const avatar = createFakeAvatar();
  const onStatusChange = vi.fn();
  const onTranscript = vi.fn();
  const onLatency = vi.fn();
  const onError = vi.fn();
  const onCheckpointStarted = vi.fn();
  const onCheckpointResult = vi.fn();
  const onModuleCompleted = vi.fn();

  const connectPromise = connectConversationSession({
    wsUrl: "wss://example.test/v1/conversations/s1/ws?ticket=abc",
    micTrack: {} as MediaStreamTrack,
    avatar,
    sessionConfig,
    onStatusChange,
    onTranscript,
    onLatency,
    onCheckpointStarted,
    onCheckpointResult,
    onModuleCompleted,
    onError,
    createWebSocket: () => ws as unknown as WebSocket,
    createMediaRecorder: () => new FakeMediaRecorder() as unknown as MediaRecorder,
    createAudioContext: () => audioContext,
    requestAnimationFrame: raf.raf,
  });

  ws.open();

  return {
    ws,
    audioContext,
    raf,
    avatar,
    onStatusChange,
    onTranscript,
    onLatency,
    onCheckpointStarted,
    onCheckpointResult,
    onModuleCompleted,
    onError,
    connectPromise,
    amplitude,
  };
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

  it("mirrors every onStatusChange transition into avatar.setPhase", async () => {
    // Regression guard: setStatus() must stay the single fan-out point for
    // both onStatusChange (UI) and avatar.setPhase (gesture animator input)
    // — this asserts they never drift apart across connect, session.ready,
    // turn.started, and disconnect.
    const { connectPromise, ws, avatar, onStatusChange } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "session.ready" });
    ws.emitMessage({ type: "turn.started", utteranceId: "u1" });

    expect(avatar.setPhase.mock.calls.map((call) => call[0])).toEqual(
      onStatusChange.mock.calls.map((call) => call[0]),
    );
    expect(avatar.setPhase).toHaveBeenCalledWith("connecting");
    expect(avatar.setPhase).toHaveBeenCalledWith("listening");
    expect(avatar.setPhase).toHaveBeenCalledWith("speaking");
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

  it("drives the avatar's emotion from an avatar transcript that carries one", async () => {
    const { connectPromise, ws, avatar } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "transcript", role: "avatar", text: "Great job!", utteranceId: "u1", final: true, emotion: "happy" });
    expect(avatar.setEmotion).toHaveBeenCalledWith("happy");
  });

  it("does not call setEmotion for a transcript with no emotion field", async () => {
    const { connectPromise, ws, avatar } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "transcript", role: "avatar", text: "hello", utteranceId: "u1", final: true });
    expect(avatar.setEmotion).not.toHaveBeenCalled();
  });

  it("does not call setEmotion for a user transcript", async () => {
    const { connectPromise, ws, avatar } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "transcript", role: "user", text: "hi", utteranceId: "u1", final: true });
    expect(avatar.setEmotion).not.toHaveBeenCalled();
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

  it("plays every queued sentence even when turn.ended arrives before earlier sentences finish playing", async () => {
    // Regression guard: the server sends turn.ended as soon as IT is done
    // streaming sentences — a fast, all-network-time step — well before the
    // client finishes actually playing them, which takes real per-sentence
    // wall-clock time. Naively nulling currentUtteranceId on turn.ended made
    // queuePlayback's staleness check treat every still-queued sentence as
    // belonging to a stale turn and silently drop it, so a multi-sentence
    // reply only ever spoke its first sentence. This is the realistic
    // ordering: all chunks plus turn.ended arrive back to back, long before
    // sentence 0 has finished playing.
    const { connectPromise, ws, avatar, onStatusChange } = setupHarness();
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
    ws.emitMessage({ type: "turn.ended", utteranceId: "u1" });

    await vi.runAllTimersAsync();

    expect(avatar.speakCalls).toEqual(["First.", "Second."]);
    // Status should only flip back to "listening" once the last sentence has
    // actually finished playing, not the moment turn.ended arrives.
    expect(onStatusChange).toHaveBeenLastCalledWith("listening");
  });

  it("keeps a turn open for barge-in until its last sentence actually finishes playing, not at turn.ended", async () => {
    // getCurrentUtteranceId() (what barge-in checks) must track "is audio
    // still playing," not "has the server finished generating." Otherwise a
    // user talking over the tail end of a multi-sentence reply would
    // silently fail to interrupt it, since turn.ended nulls the ID long
    // before local playback of later sentences finishes.
    const { connectPromise, ws, avatar, raf, amplitude } = setupHarness();
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
    ws.emitMessage({ type: "turn.ended", utteranceId: "u1" });

    // Barge in immediately — before the fake timers/microtasks that drive
    // playback have been allowed to run, so this simulates the user
    // interrupting right at the start of sentence 0.
    vi.setSystemTime(0);
    amplitude.value = 200;
    raf.tick();
    vi.setSystemTime(350);
    raf.tick();

    expect(avatar.interrupt).toHaveBeenCalled();
    expect(ws.sent).toContainEqual({ type: "barge_in", utteranceId: "u1" });
  });

  it("keeps playing later sentences in the same turn after an earlier sentence's playback throws", async () => {
    const { connectPromise, ws, avatar } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "turn.started", utteranceId: "u1" });

    avatar.speak = vi.fn((_track, text) => {
      avatar.speakCalls.push(text);
      if (text === "First.") throw new Error("avatar sdk exploded");
    });

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

    await vi.runAllTimersAsync();

    // Regression guard: playbackChain is one long-lived promise for the
    // whole session (see conversation-session.ts's queuePlayback), so a
    // rejection from one sentence must not silently skip every sentence
    // queued after it, in this turn or any future one.
    expect(avatar.speakCalls).toEqual(["First.", "Second."]);
  });

  it("keeps playing a later turn's sentences after an earlier turn's playback threw", async () => {
    const { connectPromise, ws, avatar } = setupHarness();
    await connectPromise;

    avatar.speak = vi.fn((_track, text) => {
      avatar.speakCalls.push(text);
      if (text === "Broken turn.") throw new Error("avatar sdk exploded");
    });

    ws.emitMessage({ type: "turn.started", utteranceId: "u1" });
    ws.emitMessage({
      type: "tts.chunk",
      utteranceId: "u1",
      sentenceIndex: 0,
      text: "Broken turn.",
      audioBase64: "AAAA",
      mimeType: "audio/wav",
      isLastForUtterance: true,
    });

    // Let turn u1's playback actually run (and throw) before turn u2 starts —
    // otherwise currentUtteranceId flips to u2 before queuePlayback's
    // microtask for u1 ever executes, and the existing stale-turn guard
    // (see the "drops queued tts.chunk audio for a turn that has since been
    // cancelled" test) correctly skips it for an unrelated reason, which
    // would defeat the point of this specific regression test.
    await vi.runAllTimersAsync();
    ws.emitMessage({ type: "turn.ended", utteranceId: "u1" });

    ws.emitMessage({ type: "turn.started", utteranceId: "u2" });
    ws.emitMessage({
      type: "tts.chunk",
      utteranceId: "u2",
      sentenceIndex: 0,
      text: "Next turn works fine.",
      audioBase64: "AAAA",
      mimeType: "audio/wav",
      isLastForUtterance: true,
    });

    await vi.runAllTimersAsync();

    expect(avatar.speakCalls).toEqual(["Broken turn.", "Next turn works fine."]);
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

  it("sends audio.chunk for a turn whose decoded clip has real speech-level energy", async () => {
    const { connectPromise, ws, raf, amplitude } = setupHarness(0.5); // loud decoded clip
    await connectPromise;

    vi.setSystemTime(0);
    amplitude.value = 200; // above VAD's live threshold — starts recording
    raf.tick();
    vi.setSystemTime(400);
    amplitude.value = 128; // silence begins
    raf.tick();
    vi.setSystemTime(1200); // past minSpeechDurationMs(300) + silenceDurationMs(700)
    raf.tick();

    await vi.runAllTimersAsync();

    const audioChunk = ws.sent.find(
      (m): m is { type: "audio.chunk" } => typeof m === "object" && m !== null && "type" in m && m.type === "audio.chunk",
    );
    expect(audioChunk).toBeDefined();
  });

  it("drops the turn instead of sending audio.chunk when the decoded clip never reached speech-level energy", async () => {
    // Live VAD threshold is momentarily satisfied (starting the recording),
    // but the actual decoded clip is silent overall — e.g. a noise spike,
    // not real speech. Whisper-family STT hallucinates text on clips like
    // this rather than reporting "no speech", so it must never be sent.
    const { connectPromise, ws, raf, amplitude, onStatusChange } = setupHarness(0); // silent decoded clip
    await connectPromise;

    vi.setSystemTime(0);
    amplitude.value = 200;
    raf.tick();
    vi.setSystemTime(400);
    amplitude.value = 128;
    raf.tick();
    vi.setSystemTime(1200);
    raf.tick();

    await vi.runAllTimersAsync();

    const audioChunk = ws.sent.find(
      (m): m is { type: "audio.chunk" } => typeof m === "object" && m !== null && "type" in m && m.type === "audio.chunk",
    );
    expect(audioChunk).toBeUndefined();
    expect(onStatusChange).toHaveBeenCalledWith("listening");
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

  it("forwards checkpoint.started events", async () => {
    const { connectPromise, ws, onCheckpointStarted } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "checkpoint.started", objectiveId: "obj-1", objectiveTitle: "Leave basics" });
    expect(onCheckpointStarted).toHaveBeenCalledWith({ objectiveId: "obj-1", objectiveTitle: "Leave basics" });
  });

  it("forwards checkpoint.result events", async () => {
    const { connectPromise, ws, onCheckpointResult } = setupHarness();
    await connectPromise;
    ws.emitMessage({
      type: "checkpoint.result",
      objectiveId: "obj-1",
      verdict: "PASS",
      feedback: "Correct.",
      attempts: 1,
    });
    expect(onCheckpointResult).toHaveBeenCalledWith({
      objectiveId: "obj-1",
      verdict: "PASS",
      feedback: "Correct.",
      attempts: 1,
    });
  });

  it("forwards module.completed events", async () => {
    const { connectPromise, ws, onModuleCompleted } = setupHarness();
    await connectPromise;
    ws.emitMessage({ type: "module.completed", curriculumId: "curr-1" });
    expect(onModuleCompleted).toHaveBeenCalledWith({ curriculumId: "curr-1" });
  });

  it("disconnect() sends session.end, closes the socket, and reports ended", async () => {
    const { connectPromise, ws, onStatusChange } = setupHarness();
    const handle = await connectPromise;

    handle.disconnect();

    expect(ws.sent).toContainEqual({ type: "session.end" });
    expect(ws.readyState).toBe(3);
    expect(onStatusChange).toHaveBeenCalledWith("ended");
  });

  it("rateSession() sends session.rate with the given rating and comment, without closing the socket", async () => {
    const { connectPromise, ws } = setupHarness();
    const handle = await connectPromise;

    handle.rateSession(5, "Great session!");

    expect(ws.sent).toContainEqual({ type: "session.rate", rating: 5, comment: "Great session!" });
    expect(ws.readyState).toBe(1);
  });

  it("rateSession() omits comment from the wire message when not given", async () => {
    const { connectPromise, ws } = setupHarness();
    const handle = await connectPromise;

    handle.rateSession(3);

    expect(ws.sent).toContainEqual({ type: "session.rate", rating: 3 });
  });

  it("rateSession() sent before disconnect() is delivered before the socket closes", async () => {
    const { connectPromise, ws } = setupHarness();
    const handle = await connectPromise;

    handle.rateSession(4);
    handle.disconnect();

    const rateIndex = ws.sent.findIndex((m) => (m as { type?: string }).type === "session.rate");
    const endIndex = ws.sent.findIndex((m) => (m as { type?: string }).type === "session.end");
    expect(rateIndex).toBeGreaterThanOrEqual(0);
    expect(rateIndex).toBeLessThan(endIndex);
  });

  it("ignores a malformed server message instead of throwing", async () => {
    const { connectPromise, ws } = setupHarness();
    await connectPromise;
    expect(() => ws.emitMessage({ type: "not.a.real.type" })).not.toThrow();
  });
});
