import { describe, expect, it, vi } from "vitest";
import type { LLMProvider, STTProvider, TTSProvider, VoiceTone } from "@avatrain/shared";
import { createConversationHandler, type ConversationHandlerDeps } from "./conversation-service.js";

class FakeSocket {
  readyState = 1;
  sent: unknown[] = [];
  closeCalls = 0;
  private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  on(event: string, cb: (...args: unknown[]) => void): this {
    this.listeners[event] = [...(this.listeners[event] ?? []), cb];
    return this;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
    this.emit("close");
  }
  emit(event: string, ...args: unknown[]): void {
    this.listeners[event]?.forEach((cb) => cb(...args));
  }
  emitMessage(data: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(data)));
  }
}

function fakeLLM(behavior: "success" | "throw", replyChunks: string[] = []): ConversationHandlerDeps["createLLM"] {
  return vi.fn((_env, opts) => {
    return {
      name: "fake-llm",
      async *chat() {
        if (behavior === "throw") throw new Error("llm down");
        opts?.onResolved?.("fake-gemini");
        for (const chunk of replyChunks) yield chunk;
      },
    } as LLMProvider;
  });
}

function fakeSTT(behavior: "success" | "fail" | "unconfigured", text = "hello there"): ConversationHandlerDeps["createSTT"] {
  if (behavior === "unconfigured") return vi.fn(() => null);
  // transcribe is itself a vi.fn (not a plain method) so tests can assert on
  // its call arguments, e.g. the language hint threaded through from
  // session.start — see the Hindi-wiring test below.
  const transcribe = vi.fn(async () => {
    if (behavior === "fail") throw new Error("stt down");
    return text;
  });
  return vi.fn(() => ({ name: "fake-stt", transcribe }) as unknown as STTProvider);
}

function fakeTTS(behavior: "success" | "fail"): ConversationHandlerDeps["createTTS"] {
  return vi.fn((_tone: VoiceTone, _gender, _language, _env, opts) => {
    return {
      name: "fake-tts",
      mimeType: "audio/wav",
      async *synthesize() {
        if (behavior === "fail") throw new Error("tts down");
        opts?.onResolved?.("fake-echogarden", "audio/wav");
        yield new Uint8Array([1, 2, 3]);
      },
    } as TTSProvider;
  });
}

const claims = { orgId: "org-1", userId: "user-1" };

function findMessages(socket: FakeSocket, type: string): Record<string, unknown>[] {
  return socket.sent.filter(
    (m): m is Record<string, unknown> => typeof m === "object" && m !== null && (m as { type?: string }).type === type,
  );
}

describe("createConversationHandler", () => {
  it("session.start constructs providers and replies with session.ready", () => {
    const socket = new FakeSocket();
    const createLLM = fakeLLM("success");
    const createSTT = fakeSTT("success");
    const createTTS = fakeTTS("success");
    createConversationHandler(socket as never, claims, { createLLM, createSTT, createTTS });

    socket.emitMessage({
      type: "session.start",
      avatarName: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "HR & Leave Policy",
    });

    expect(socket.sent).toContainEqual({ type: "session.ready" });
    expect(createLLM).toHaveBeenCalled();
    expect(createSTT).toHaveBeenCalled();
  });

  it("session.start without a language field defaults to English (backward compatible)", () => {
    const socket = new FakeSocket();
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success"),
      createSTT: fakeSTT("success"),
      createTTS: fakeTTS("success"),
    });
    socket.emitMessage({
      type: "session.start",
      avatarName: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "t",
    });
    expect(socket.sent).toContainEqual({ type: "session.ready" });
  });

  it("threads a Hindi session.start into the TTS language and the Whisper STT language hint", async () => {
    const socket = new FakeSocket();
    const createTTS = fakeTTS("success");
    const createSTT = fakeSTT("success");
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success", ["ठीक है। "]),
      createSTT,
      createTTS,
    });
    socket.emitMessage({
      type: "session.start",
      avatarName: "Priya",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "HR & Leave Policy",
      language: "Hindi",
    });
    socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.ended")).toHaveLength(1);
    });

    expect(createTTS).toHaveBeenCalledWith("WARM", "FEMALE", "Hindi", process.env, expect.anything());
    const sttInstance = (createSTT as unknown as { mock: { results: { value: STTProvider }[] } }).mock.results[0]!
      .value;
    expect(sttInstance.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), "audio/wav", { language: "hi" });
  });

  it("processes a full audio turn: transcript, turn.started, tts.chunk, turn.ended, latency", async () => {
    const socket = new FakeSocket();
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success", ["Hello. ", "How can I help? "]),
      createSTT: fakeSTT("success", "hi there"),
      createTTS: fakeTTS("success"),
    });
    socket.emitMessage({
      type: "session.start",
      avatarName: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "HR & Leave Policy",
    });

    socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.ended")).toHaveLength(1);
    });

    expect(findMessages(socket, "transcript")).toContainEqual({
      type: "transcript",
      role: "user",
      text: "hi there",
      utteranceId: "u1",
      final: true,
    });
    expect(findMessages(socket, "turn.started")).toEqual([{ type: "turn.started", utteranceId: "u1" }]);
    const ttsChunks = findMessages(socket, "tts.chunk");
    expect(ttsChunks).toHaveLength(2);
    expect(ttsChunks[0]).toMatchObject({ sentenceIndex: 0, text: "Hello.", isLastForUtterance: false });
    expect(ttsChunks[1]).toMatchObject({ sentenceIndex: 1, text: "How can I help?", isLastForUtterance: true });
    const latency = findMessages(socket, "latency")[0];
    expect(latency).toMatchObject({
      utteranceId: "u1",
      servedBy: { llm: "fake-gemini", stt: "fake-stt", tts: "fake-echogarden" },
    });
  });

  it("sends stt.failed and never starts a turn when no STT provider is configured", async () => {
    const socket = new FakeSocket();
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success", ["hi"]),
      createSTT: fakeSTT("unconfigured"),
      createTTS: fakeTTS("success"),
    });
    socket.emitMessage({
      type: "session.start",
      avatarName: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "t",
    });
    socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "stt.failed")).toHaveLength(1);
    });
    expect(findMessages(socket, "turn.started")).toHaveLength(0);
  });

  it("text.fallback skips STT entirely and still produces a full turn", async () => {
    const socket = new FakeSocket();
    const createSTT = fakeSTT("success");
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success", ["Got it. "]),
      createSTT,
      createTTS: fakeTTS("success"),
    });
    socket.emitMessage({
      type: "session.start",
      avatarName: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "t",
    });
    socket.emitMessage({ type: "text.fallback", utteranceId: "u1", text: "recognized via web speech" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.ended")).toHaveLength(1);
    });
    expect(findMessages(socket, "transcript")).toContainEqual({
      type: "transcript",
      role: "user",
      text: "recognized via web speech",
      utteranceId: "u1",
      final: true,
    });
  });

  it("sends turn.failed(llm) when the LLM provider throws", async () => {
    const socket = new FakeSocket();
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("throw"),
      createSTT: fakeSTT("success"),
      createTTS: fakeTTS("success"),
    });
    socket.emitMessage({
      type: "session.start",
      avatarName: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "t",
    });
    socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.failed")).toHaveLength(1);
    });
    expect(findMessages(socket, "turn.failed")[0]).toMatchObject({ kind: "llm", utteranceId: "u1" });
    expect(findMessages(socket, "turn.ended")).toHaveLength(0);
  });

  it("sends turn.failed(tts) when every sentence's TTS synthesis fails", async () => {
    const socket = new FakeSocket();
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success", ["Hello there. "]),
      createSTT: fakeSTT("success"),
      createTTS: fakeTTS("fail"),
    });
    socket.emitMessage({
      type: "session.start",
      avatarName: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "t",
    });
    socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.failed")).toHaveLength(1);
    });
    expect(findMessages(socket, "turn.failed")[0]).toMatchObject({ kind: "tts" });
    expect(findMessages(socket, "tts.chunk")).toHaveLength(0);
  });

  it("barge_in for the current utterance aborts and sends turn.cancelled", async () => {
    const socket = new FakeSocket();
    let releaseChat!: () => void;
    const chatGate = new Promise<void>((resolve) => {
      releaseChat = resolve;
    });
    const createLLM = vi.fn((_env, opts) => {
      return {
        name: "fake-llm",
        async *chat(_messages: unknown, chatOpts: { signal: AbortSignal }) {
          opts?.onResolved?.("fake-gemini");
          yield "First. ";
          await chatGate;
          if (chatOpts.signal.aborted) return;
          yield "Should not arrive. ";
        },
      } as LLMProvider;
    });
    createConversationHandler(socket as never, claims, {
      createLLM,
      createSTT: fakeSTT("success"),
      createTTS: fakeTTS("success"),
    });
    socket.emitMessage({
      type: "session.start",
      avatarName: "Nancy",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      topic: "t",
    });
    socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.started")).toHaveLength(1);
    });

    socket.emitMessage({ type: "barge_in", utteranceId: "u1" });
    releaseChat();

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.cancelled")).toHaveLength(1);
    });
    expect(findMessages(socket, "turn.ended")).toHaveLength(0);
  });

  it("ignores a barge_in for a stale utteranceId", () => {
    const socket = new FakeSocket();
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success", ["hi"]),
      createSTT: fakeSTT("success"),
      createTTS: fakeTTS("success"),
    });
    socket.emitMessage({ type: "barge_in", utteranceId: "never-started" });
    expect(findMessages(socket, "turn.cancelled")).toHaveLength(0);
  });

  it("session.end closes the socket", () => {
    const socket = new FakeSocket();
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success"),
      createSTT: fakeSTT("success"),
      createTTS: fakeTTS("success"),
    });
    socket.emitMessage({ type: "session.end" });
    expect(socket.closeCalls).toBe(1);
  });

  it("responds with an error message instead of throwing on a malformed frame", () => {
    const socket = new FakeSocket();
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success"),
      createSTT: fakeSTT("success"),
      createTTS: fakeTTS("success"),
    });
    expect(() => socket.emitMessage({ type: "not.a.real.type" })).not.toThrow();
    expect(findMessages(socket, "error")).toEqual([{ type: "error", code: "invalid_message" }]);
  });
});
