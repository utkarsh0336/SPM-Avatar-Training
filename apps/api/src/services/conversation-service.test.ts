import { describe, expect, it, vi } from "vitest";
import type { LLMMessage, LLMProvider, LLMStreamEvent, ObjectiveProgressVerdict, STTProvider, TTSProvider, VoiceTone } from "@avatrain/shared";
import { createConversationHandler, type ConversationHandlerDeps } from "./conversation-service.js";
import type { RetrievedChunk } from "./retrieval-service.js";
import type { SessionCurriculum, SessionCurriculumObjective } from "./curriculum-service.js";
import { createTurnLatencyCircuitBreaker, TURN_TTFA_BUDGET_MS } from "./turn-latency-guard.js";

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
        for (const chunk of replyChunks) yield { type: "text", text: chunk } satisfies LLMStreamEvent;
      },
    } as LLMProvider;
  });
}

/**
 * Scripts the "teaching" provider's chat() across multiple calls (one
 * script array per round-trip within a turn) while ALSO handling the
 * separate grade_answer judge call — both come through this same injected
 * createLLM factory (see conversation-service.ts's gradeAnswerWithJudge,
 * which calls the injected factory fresh rather than reusing the session's
 * `llm`), distinguished by systemPrompt content since that's the only
 * signal chat() receives that tells the two apart.
 */
function fakeCurriculumLLM(
  teachingScript: LLMStreamEvent[][],
  judgeVerdict: ObjectiveProgressVerdict = "PASS",
  // advance_scenario's classify judge — distinguished from the grade_answer judge by its own
  // distinct systemPrompt prefix ("You are classifying"). Letter selects which branch it picks;
  // see conversation-service.ts's classifyScenarioAnswerWithJudge.
  branchLetter = "A",
): ConversationHandlerDeps["createLLM"] {
  let teachingCallIndex = 0;
  return vi.fn((_env, opts) => {
    return {
      name: "fake-llm",
      async *chat(_messages: LLMMessage[], chatOpts: { systemPrompt: string }) {
        if (chatOpts.systemPrompt.startsWith("You are grading")) {
          yield { type: "text", text: `VERDICT: ${judgeVerdict}\nFeedback line.` } satisfies LLMStreamEvent;
          return;
        }
        if (chatOpts.systemPrompt.startsWith("You are classifying")) {
          yield { type: "text", text: `BRANCH: ${branchLetter}\nFeedback line.` } satisfies LLMStreamEvent;
          return;
        }
        opts?.onResolved?.("fake-gemini");
        const events = teachingScript[teachingCallIndex] ?? [];
        teachingCallIndex += 1;
        for (const event of events) yield event;
      },
    } as unknown as LLMProvider;
  });
}

function fakeCurriculum(objectives: SessionCurriculumObjective[]): ConversationHandlerDeps["getCurriculumForAvatar"] {
  return vi.fn(async (): Promise<SessionCurriculum> => ({ curriculumId: "curr-1", objectives }));
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

// Resolves immediately with no chunks by default — keeps every test that
// doesn't care about retrieval fast and hermetic, same reasoning as
// fakeLLM/fakeSTT/fakeTTS existing to avoid hitting a real provider.
function fakeRetrieveContext(chunks: RetrievedChunk[] = []): ConversationHandlerDeps["retrieveContext"] {
  return vi.fn(async () => chunks);
}

const claims = { orgId: "org-1", userId: "user-1" };

const noRetrieval = { retrieveContext: fakeRetrieveContext() };

// No curriculum by default — every test that doesn't care about the
// checkpoint/grading loop gets the exact pre-existing behavior (no avatarId
// sent, so getCurriculumForAvatar is never even called).
const sessionStartBase = {
  type: "session.start" as const,
  avatarName: "Nancy",
  expertise: "HR_LEAVE_POLICY" as const,
  voiceTone: "WARM" as const,
  style: "REALISTIC" as const,
  gender: "FEMALE" as const,
  outfit: "BUSINESS_FORMAL" as const,
  topic: "HR & Leave Policy",
};

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
    createConversationHandler(socket as never, claims, { createLLM, createSTT, createTTS, ...noRetrieval });

    socket.emitMessage(sessionStartBase);

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
      ...noRetrieval,
    });
    socket.emitMessage(sessionStartBase);
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
      ...noRetrieval,
    });
    socket.emitMessage({ ...sessionStartBase, avatarName: "Priya", language: "Hindi" });
    socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.ended")).toHaveLength(1);
    });

    expect(createTTS).toHaveBeenCalledWith("WARM", "FEMALE", "Hindi", process.env, expect.anything());
    const sttInstance = (createSTT as unknown as { mock: { results: { value: STTProvider }[] } }).mock.results[0]!
      .value;
    // sessionStartBase's expertise is HR_LEAVE_POLICY — see the dedicated
    // accent-adaptation test below for the prompt field's own coverage.
    expect(sttInstance.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), "audio/wav", {
      language: "hi",
      prompt: "HR & Leave Policy",
    });
  });

  it("threads the session's expertise topic into Whisper's `prompt` accent/vocabulary-bias hint", async () => {
    const socket = new FakeSocket();
    const createSTT = fakeSTT("success");
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success", ["Hi. "]),
      createSTT,
      createTTS: fakeTTS("success"),
      ...noRetrieval,
    });
    socket.emitMessage({ ...sessionStartBase, expertise: "IT_TECHNOLOGY" });
    socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.ended")).toHaveLength(1);
    });

    const sttInstance = (createSTT as unknown as { mock: { results: { value: STTProvider }[] } }).mock.results[0]!
      .value;
    expect(sttInstance.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), "audio/wav", {
      language: "en",
      prompt: "IT & Technology",
    });
  });

  it("processes a full audio turn: transcript, turn.started, tts.chunk, turn.ended, latency", async () => {
    const socket = new FakeSocket();
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success", ["Hello. ", "How can I help? "]),
      createSTT: fakeSTT("success", "hi there"),
      createTTS: fakeTTS("success"),
      ...noRetrieval,
    });
    socket.emitMessage(sessionStartBase);

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
    expect(typeof latency!.retrievalMs).toBe("number");
    // Ungrounded (fakeRetrieveContext defaults to []) — no sources attached.
    const avatarTranscript = findMessages(socket, "transcript").find((m) => m.role === "avatar");
    expect(avatarTranscript?.sources).toBeUndefined();
    // Plain informational reply — classifyEmotion reads it as neutral, and
    // (unlike sources) emotion is always set, never omitted, for role:"avatar".
    expect(avatarTranscript?.emotion).toBe("neutral");
  });

  describe("trainingSessionId persistence hook", () => {
    // Regression guard for the fire-and-forget contract CLAUDE.md's "avoid blocking the realtime
    // audio path" requires: persistTrainingSessionMessage is injected with a promise that never
    // resolves for the lifetime of this test, yet the turn still completes and sends turn.ended —
    // proof that processTurn never awaits it, directly (not just "the code looks fire-and-forget").
    it("never blocks the turn even when the injected persist function hangs forever", async () => {
      const socket = new FakeSocket();
      const persistTrainingSessionMessage = vi.fn(() => new Promise<void>(() => {})); // never resolves
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hello. ", "How can I help? "]),
        createSTT: fakeSTT("success", "hi there"),
        createTTS: fakeTTS("success"),
        trainingSessionId: "ts-1",
        persistTrainingSessionMessage,
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(persistTrainingSessionMessage).toHaveBeenCalledWith("org-1", "ts-1", "USER", "hi there");
      expect(persistTrainingSessionMessage).toHaveBeenCalledWith(
        "org-1",
        "ts-1",
        "AVATAR",
        "Hello. How can I help? ",
      );
    });

    it("never calls persistTrainingSessionMessage when trainingSessionId is omitted (anonymous embed sessions)", async () => {
      const socket = new FakeSocket();
      const persistTrainingSessionMessage = vi.fn(async () => {});
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hi. "]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        persistTrainingSessionMessage,
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(persistTrainingSessionMessage).not.toHaveBeenCalled();
    });
  });

  describe("recordKnowledgeAccess hook", () => {
    const chunk = { documentId: "8c9a6c1a-6d1a-4c2e-9c1a-6d1a4c2e9c1a", documentTitle: "Leave Policy", content: "20 days.", similarity: 0.9 };

    // Same fire-and-forget regression guard as the persistTrainingSessionMessage test above —
    // recordKnowledgeAccess is injected with a promise that never resolves, yet the turn still
    // completes, proving the retrieval-path write is never awaited.
    it("never blocks the turn even when the injected recordKnowledgeAccess hangs forever", async () => {
      const socket = new FakeSocket();
      const recordKnowledgeAccess = vi.fn(() => new Promise<void>(() => {})); // never resolves
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hello. "]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        trainingSessionId: "ts-1",
        recordKnowledgeAccess,
        retrieveContext: fakeRetrieveContext([chunk]),
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(recordKnowledgeAccess).toHaveBeenCalledWith("org-1", chunk.documentId, "ts-1");
    });

    // Deliberately the opposite of persistTrainingSessionMessage's no-op-when-null contract — an
    // anonymous apps/widget embed session's retrieval is exactly the real usage
    // .claude/specs/dashboard-analytics.md's KnowledgeAccessEvent exists to capture.
    it("still fires when trainingSessionId is omitted (anonymous embed sessions) — does not no-op", async () => {
      const socket = new FakeSocket();
      const recordKnowledgeAccess = vi.fn(async () => {});
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hi. "]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        recordKnowledgeAccess,
        retrieveContext: fakeRetrieveContext([chunk]),
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(recordKnowledgeAccess).toHaveBeenCalledWith("org-1", chunk.documentId, null);
    });

    it("calls once per distinct documentId, not once per chunk", async () => {
      const socket = new FakeSocket();
      const recordKnowledgeAccess = vi.fn(async () => {});
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hi. "]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        recordKnowledgeAccess,
        retrieveContext: fakeRetrieveContext([
          chunk,
          { ...chunk, content: "a different chunk, same document" },
        ]),
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(recordKnowledgeAccess).toHaveBeenCalledTimes(1);
    });

    it("never calls recordKnowledgeAccess when retrieval finds nothing", async () => {
      const socket = new FakeSocket();
      const recordKnowledgeAccess = vi.fn(async () => {});
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hi. "]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        recordKnowledgeAccess,
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(recordKnowledgeAccess).not.toHaveBeenCalled();
    });
  });

  describe("recordTurnMetric hook", () => {
    const chunk = { documentId: "8c9a6c1a-6d1a-4c2e-9c1a-6d1a4c2e9c1a", documentTitle: "Leave Policy", content: "20 days.", similarity: 0.9 };

    // Same fire-and-forget regression guard as recordKnowledgeAccess's own test above —
    // recordTurnMetric is injected with a promise that never resolves, yet the turn still
    // completes, proving the turn-completion-path write is never awaited.
    it("never blocks the turn even when the injected recordTurnMetric hangs forever", async () => {
      const socket = new FakeSocket();
      const recordTurnMetric = vi.fn(() => new Promise<void>(() => {})); // never resolves
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hello. "]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        trainingSessionId: "ts-1",
        recordTurnMetric,
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(recordTurnMetric).toHaveBeenCalledWith(
        "org-1",
        "ts-1",
        expect.objectContaining({ totalMs: expect.any(Number), grounded: false }),
      );
    });

    // Deliberately the opposite of persistTrainingSessionMessage's no-op-when-null contract — an
    // anonymous apps/widget embed session's turn is exactly the real usage
    // .claude/specs/ai-performance-analytics.md's TurnMetric exists to capture.
    it("still fires when trainingSessionId is omitted (anonymous embed sessions) — does not no-op", async () => {
      const socket = new FakeSocket();
      const recordTurnMetric = vi.fn(async () => {});
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hi. "]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        recordTurnMetric,
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(recordTurnMetric).toHaveBeenCalledWith("org-1", null, expect.objectContaining({ grounded: false }));
    });

    it("marks grounded: true when retrieval returned at least one chunk", async () => {
      const socket = new FakeSocket();
      const recordTurnMetric = vi.fn(async () => {});
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hi. "]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        recordTurnMetric,
        retrieveContext: fakeRetrieveContext([chunk]),
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(recordTurnMetric).toHaveBeenCalledWith("org-1", null, expect.objectContaining({ grounded: true }));
    });

    it("marks grounded: false when retrieval found nothing (ungrounded Priority-3 fallback)", async () => {
      const socket = new FakeSocket();
      const recordTurnMetric = vi.fn(async () => {});
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hi. "]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        recordTurnMetric,
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(recordTurnMetric).toHaveBeenCalledWith("org-1", null, expect.objectContaining({ grounded: false }));
    });
  });

  describe("session.rate", () => {
    it("calls recordSatisfactionRating with the rating and comment, and does not close the socket", () => {
      const socket = new FakeSocket();
      const recordSatisfactionRating = vi.fn(async () => {});
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success"),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        recordSatisfactionRating,
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "session.rate", rating: 5, comment: "Great session!" });

      expect(recordSatisfactionRating).toHaveBeenCalledWith("org-1", null, 5, "Great session!");
      expect(socket.closeCalls).toBe(0);
    });

    it("passes null when comment is omitted", () => {
      const socket = new FakeSocket();
      const recordSatisfactionRating = vi.fn(async () => {});
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success"),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        recordSatisfactionRating,
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "session.rate", rating: 3 });

      expect(recordSatisfactionRating).toHaveBeenCalledWith("org-1", null, 3, null);
    });

    // Deliberately the opposite of persistTrainingSessionMessage's no-op-when-null contract — an
    // anonymous apps/widget embed session's rating is exactly the real usage
    // .claude/specs/user-satisfaction.md's SatisfactionRating exists to capture.
    it("still fires when trainingSessionId is omitted (anonymous embed sessions) — does not no-op", () => {
      const socket = new FakeSocket();
      const recordSatisfactionRating = vi.fn(async () => {});
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success"),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        recordSatisfactionRating,
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "session.rate", rating: 4 });

      expect(recordSatisfactionRating).toHaveBeenCalledWith("org-1", null, 4, null);
    });

    it("uses the connection's real trainingSessionId for a rehearsal session", () => {
      const socket = new FakeSocket();
      const recordSatisfactionRating = vi.fn(async () => {});
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success"),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        trainingSessionId: "ts-1",
        recordSatisfactionRating,
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "session.rate", rating: 2 });

      expect(recordSatisfactionRating).toHaveBeenCalledWith("org-1", "ts-1", 2, null);
    });

    it("never blocks even when the injected recordSatisfactionRating hangs forever", () => {
      const socket = new FakeSocket();
      const recordSatisfactionRating = vi.fn(() => new Promise<void>(() => {})); // never resolves
      expect(() => {
        createConversationHandler(socket as never, claims, {
          createLLM: fakeLLM("success"),
          createSTT: fakeSTT("success"),
          createTTS: fakeTTS("success"),
          recordSatisfactionRating,
          ...noRetrieval,
        });
        socket.emitMessage(sessionStartBase);
        socket.emitMessage({ type: "session.rate", rating: 1 });
      }).not.toThrow();
    });
  });

  describe("turn-latency SLA gate", () => {
    it("sends latency.budget_exceeded once when TTS runs past the TTFA budget, and the turn still completes", async () => {
      vi.useFakeTimers();
      try {
        const socket = new FakeSocket();
        let releaseSynth: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
          releaseSynth = resolve;
        });
        const createTTS: ConversationHandlerDeps["createTTS"] = vi.fn((_tone, _gender, _language, _env, opts) => {
          return {
            name: "fake-tts",
            mimeType: "audio/wav",
            async *synthesize() {
              await gate;
              opts?.onResolved?.("fake-echogarden", "audio/wav");
              yield new Uint8Array([1, 2, 3]);
            },
          } as never;
        });
        createConversationHandler(socket as never, claims, {
          createLLM: fakeLLM("success", ["Hi. "]),
          createSTT: fakeSTT("success"),
          createTTS,
          turnLatencyCircuitBreaker: createTurnLatencyCircuitBreaker(),
          ...noRetrieval,
        });
        socket.emitMessage(sessionStartBase);
        socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

        await vi.advanceTimersByTimeAsync(TURN_TTFA_BUDGET_MS);
        expect(findMessages(socket, "latency.budget_exceeded")).toEqual([
          { type: "latency.budget_exceeded", utteranceId: "u1", budgetMs: TURN_TTFA_BUDGET_MS },
        ]);

        // Switch back to real timers before releasing the gate — vi.waitFor's
        // own polling doesn't advance fake timers on its own.
        vi.useRealTimers();
        releaseSynth!();
        await vi.waitFor(() => {
          expect(findMessages(socket, "turn.ended")).toHaveLength(1);
        });
        // Still exactly one — clearing the watchdog on first audio must
        // prevent a second, stale firing.
        expect(findMessages(socket, "latency.budget_exceeded")).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("skips retrieval and forces fallback-first TTS once the circuit breaker is tripped for the org", async () => {
      const socket = new FakeSocket();
      const breaker = createTurnLatencyCircuitBreaker({ budgetMs: TURN_TTFA_BUDGET_MS, consecutiveMissesToTrip: 3 });
      breaker.recordTurn(claims.orgId, TURN_TTFA_BUDGET_MS + 100);
      breaker.recordTurn(claims.orgId, TURN_TTFA_BUDGET_MS + 100);
      breaker.recordTurn(claims.orgId, TURN_TTFA_BUDGET_MS + 100);
      expect(breaker.isTripped(claims.orgId)).toBe(true);

      const retrieveContext = fakeRetrieveContext();
      const createTTS = fakeTTS("success");
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hi. "]),
        createSTT: fakeSTT("success"),
        createTTS,
        retrieveContext,
        turnLatencyCircuitBreaker: breaker,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(retrieveContext).not.toHaveBeenCalled();
      expect(createTTS).toHaveBeenCalledWith(
        "WARM",
        "FEMALE",
        "English",
        process.env,
        expect.objectContaining({ forceFallbackFirst: true }),
      );
    });

    it("does not skip retrieval or force fallback-first TTS when the breaker is untripped", async () => {
      const socket = new FakeSocket();
      const retrieveContext = fakeRetrieveContext();
      const createTTS = fakeTTS("success");
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hi. "]),
        createSTT: fakeSTT("success"),
        createTTS,
        retrieveContext,
        turnLatencyCircuitBreaker: createTurnLatencyCircuitBreaker(),
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(retrieveContext).toHaveBeenCalledTimes(1);
      expect(createTTS).toHaveBeenCalledWith(
        "WARM",
        "FEMALE",
        "English",
        process.env,
        expect.objectContaining({ forceFallbackFirst: false }),
      );
    });
  });

  it("attaches the classified emotion to an avatar transcript, even when it's neutral", async () => {
    const socket = new FakeSocket();
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success", ["Great job, that's exactly right!"]),
      createSTT: fakeSTT("success", "did I get it right?"),
      createTTS: fakeTTS("success"),
      ...noRetrieval,
    });
    socket.emitMessage(sessionStartBase);
    socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.ended")).toHaveLength(1);
    });

    const avatarTranscript = findMessages(socket, "transcript").find((m) => m.role === "avatar");
    expect(avatarTranscript?.emotion).toBe("happy");
  });

  it("grounds the reply and attaches source attribution when retrieval finds relevant chunks", async () => {
    const socket = new FakeSocket();
    const retrieveContext = fakeRetrieveContext([
      { documentId: "8c9a6c1a-6d1a-4c2e-9c1a-6d1a4c2e9c1a", documentTitle: "Leave Policy", content: "20 days of leave.", similarity: 0.9 },
    ]);
    let capturedSystemPrompt = "";
    const createLLM = vi.fn((_env, opts) => {
      return {
        name: "fake-llm",
        async *chat(_messages: unknown, chatOpts: { systemPrompt: string }) {
          capturedSystemPrompt = chatOpts.systemPrompt;
          opts?.onResolved?.("fake-gemini");
          yield { type: "text", text: "You get 20 days. " } satisfies LLMStreamEvent;
        },
      } as LLMProvider;
    });
    createConversationHandler(socket as never, claims, {
      createLLM,
      createSTT: fakeSTT("success"),
      createTTS: fakeTTS("success"),
      retrieveContext,
    });
    socket.emitMessage(sessionStartBase);
    socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.ended")).toHaveLength(1);
    });

    expect(retrieveContext).toHaveBeenCalledWith("org-1", "hello there");
    expect(capturedSystemPrompt).toContain("Leave Policy");
    expect(capturedSystemPrompt).toContain("20 days of leave.");

    const avatarTranscript = findMessages(socket, "transcript").find((m) => m.role === "avatar");
    expect(avatarTranscript?.sources).toEqual([
      { documentId: "8c9a6c1a-6d1a-4c2e-9c1a-6d1a4c2e9c1a", title: "Leave Policy" },
    ]);
  });

  it("degrades to an ungrounded reply, without failing the turn, when retrieval throws", async () => {
    const socket = new FakeSocket();
    const retrieveContext = vi.fn(async () => {
      throw new Error("embedding provider down");
    });
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success", ["Still works. "]),
      createSTT: fakeSTT("success"),
      createTTS: fakeTTS("success"),
      retrieveContext,
    });
    socket.emitMessage(sessionStartBase);
    socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.ended")).toHaveLength(1);
    });
    expect(findMessages(socket, "turn.failed")).toHaveLength(0);
    const avatarTranscript = findMessages(socket, "transcript").find((m) => m.role === "avatar");
    expect(avatarTranscript?.sources).toBeUndefined();
  });

  it("sends stt.failed and never starts a turn when no STT provider is configured", async () => {
    const socket = new FakeSocket();
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success", ["hi"]),
      createSTT: fakeSTT("unconfigured"),
      createTTS: fakeTTS("success"),
      ...noRetrieval,
    });
    socket.emitMessage(sessionStartBase);
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
      ...noRetrieval,
    });
    socket.emitMessage(sessionStartBase);
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
      ...noRetrieval,
    });
    socket.emitMessage(sessionStartBase);
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
      ...noRetrieval,
    });
    socket.emitMessage(sessionStartBase);
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
          yield { type: "text", text: "First. " } satisfies LLMStreamEvent;
          await chatGate;
          if (chatOpts.signal.aborted) return;
          yield { type: "text", text: "Should not arrive. " } satisfies LLMStreamEvent;
        },
      } as LLMProvider;
    });
    createConversationHandler(socket as never, claims, {
      createLLM,
      createSTT: fakeSTT("success"),
      createTTS: fakeTTS("success"),
      ...noRetrieval,
    });
    socket.emitMessage(sessionStartBase);
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

  it("barge_in arriving while retrieval is still in flight still cancels cleanly (no turn.ended, no turn.failed)", async () => {
    const socket = new FakeSocket();
    let releaseRetrieval!: () => void;
    const retrievalGate = new Promise<RetrievedChunk[]>((resolve) => {
      releaseRetrieval = () => resolve([]);
    });
    // Retrieval isn't wired to the turn's AbortController (documented scope
    // decision — see conversation-service.ts) — this proves a barge_in that
    // arrives mid-retrieval is still handled correctly once retrieval does
    // eventually resolve, rather than the LLM's abort-signal handling being
    // the only thing exercised by the existing "aborts and sends
    // turn.cancelled" test above (which gates the LLM stream, not retrieval).
    const retrieveContext = vi.fn(() => retrievalGate);
    const createLLM = fakeLLM("success", ["Should not arrive. "]);
    createConversationHandler(socket as never, claims, {
      createLLM,
      createSTT: fakeSTT("success"),
      createTTS: fakeTTS("success"),
      retrieveContext,
    });
    socket.emitMessage(sessionStartBase);
    socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.started")).toHaveLength(1);
    });
    expect(retrieveContext).toHaveBeenCalled();

    // barge_in arrives before retrieval has resolved — currentUtteranceId
    // is already set (before the retrieval await), so this must still find
    // and abort the in-flight turn rather than being a no-op.
    socket.emitMessage({ type: "barge_in", utteranceId: "u1" });
    releaseRetrieval();

    await vi.waitFor(() => {
      expect(findMessages(socket, "turn.cancelled")).toHaveLength(1);
    });
    expect(findMessages(socket, "turn.ended")).toHaveLength(0);
    expect(findMessages(socket, "turn.failed")).toHaveLength(0);
  });

  it("ignores a barge_in for a stale utteranceId", () => {
    const socket = new FakeSocket();
    createConversationHandler(socket as never, claims, {
      createLLM: fakeLLM("success", ["hi"]),
      createSTT: fakeSTT("success"),
      createTTS: fakeTTS("success"),
      ...noRetrieval,
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
      ...noRetrieval,
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
      ...noRetrieval,
    });
    expect(() => socket.emitMessage({ type: "not.a.real.type" })).not.toThrow();
    expect(findMessages(socket, "error")).toEqual([{ type: "error", code: "invalid_message" }]);
  });

  describe("checkpoint/grading tool loop", () => {
    const objectives: SessionCurriculumObjective[] = [
      {
        id: "obj-1",
        title: "Leave basics",
        teachingContent: "20 days a year.",
        checkQuestion: "How many days?",
        gradingCriteria: "Answer must say 20 days.",
        scenarioSteps: [],
        status: "NOT_STARTED",
      },
    ];

    it("does nothing tool-related when session.start omits avatarId, even with a curriculum dep configured", async () => {
      const socket = new FakeSocket();
      const getCurriculumForAvatar = fakeCurriculum(objectives);
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Just talking. "]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar,
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });
      expect(getCurriculumForAvatar).not.toHaveBeenCalled();
      expect(findMessages(socket, "checkpoint.started")).toHaveLength(0);
    });

    it("start_checkpoint sends checkpoint.started with the objective's title", async () => {
      const socket = new FakeSocket();
      createConversationHandler(socket as never, claims, {
        createLLM: fakeCurriculumLLM([
          [{ type: "tool_call", id: "call-1", name: "start_checkpoint", args: { objectiveId: "obj-1" } }],
          [{ type: "text", text: "How many days do you get?" }],
        ]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar: fakeCurriculum(objectives),
        getAvatarById: vi.fn(async () => null),
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });
      expect(findMessages(socket, "checkpoint.started")).toEqual([
        { type: "checkpoint.started", objectiveId: "obj-1", objectiveTitle: "Leave basics" },
      ]);
      const avatarTranscript = findMessages(socket, "transcript").find((m) => m.role === "avatar");
      expect(avatarTranscript?.text).toBe("How many days do you get?");
    });

    it("flushes sentence audio spoken before a tool call immediately, not held hostage behind the tool round-trip", async () => {
      const socket = new FakeSocket();
      let releaseRound2!: () => void;
      const round2Gate = new Promise<void>((resolve) => {
        releaseRound2 = resolve;
      });
      let callIndex = 0;
      const createLLM = vi.fn((_env, opts) => {
        return {
          name: "fake-llm",
          async *chat(_messages: LLMMessage[], _chatOpts: { systemPrompt: string }) {
            opts?.onResolved?.("fake-gemini");
            const index = callIndex;
            callIndex += 1;
            if (index === 0) {
              yield { type: "text", text: "Let me check that. " } satisfies LLMStreamEvent;
              yield {
                type: "tool_call",
                id: "call-1",
                name: "start_checkpoint",
                args: { objectiveId: "obj-1" },
              } satisfies LLMStreamEvent;
            } else {
              await round2Gate;
              yield { type: "text", text: "How many days do you get?" } satisfies LLMStreamEvent;
            }
          },
        } as unknown as LLMProvider;
      });

      createConversationHandler(socket as never, claims, {
        createLLM,
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar: fakeCurriculum(objectives),
        getAvatarById: vi.fn(async () => null),
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      // Round 2 (the continuation after the tool call) is deliberately
      // still blocked here — this proves sentence 0's audio was flushed
      // before, not after, the tool round-trip completed.
      await vi.waitFor(() => {
        expect(findMessages(socket, "tts.chunk")).toHaveLength(1);
      });
      expect(findMessages(socket, "tts.chunk")[0]).toMatchObject({
        sentenceIndex: 0,
        text: "Let me check that.",
        isLastForUtterance: false,
      });
      expect(findMessages(socket, "turn.ended")).toHaveLength(0);

      releaseRound2();

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });
      const chunks = findMessages(socket, "tts.chunk");
      expect(chunks).toHaveLength(2);
      expect(chunks[1]).toMatchObject({ sentenceIndex: 1, text: "How many days do you get?", isLastForUtterance: true });
    });

    it("grade_answer (PASS) then record_progress persists progress and sends checkpoint.result", async () => {
      const socket = new FakeSocket();
      const recordObjectiveProgress = vi.fn(async () => ({ attempts: 1 }));
      createConversationHandler(socket as never, claims, {
        createLLM: fakeCurriculumLLM(
          [
            [{ type: "tool_call", id: "call-1", name: "grade_answer", args: { objectiveId: "obj-1" } }],
            [{ type: "tool_call", id: "call-2", name: "record_progress", args: { objectiveId: "obj-1" } }],
            [{ type: "text", text: "Correct, well done!" }],
          ],
          "PASS",
        ),
        createSTT: fakeSTT("success", "20 days"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar: fakeCurriculum(objectives),
        getAvatarById: vi.fn(async () => null),
        recordObjectiveProgress,
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(recordObjectiveProgress).toHaveBeenCalledWith("org-1", "obj-1", "user-1", "PASS", "Feedback line.");
      expect(findMessages(socket, "checkpoint.result")).toEqual([
        { type: "checkpoint.result", objectiveId: "obj-1", verdict: "PASS", feedback: "Feedback line.", attempts: 1 },
      ]);
      const avatarTranscript = findMessages(socket, "transcript").find((m) => m.role === "avatar");
      expect(avatarTranscript?.text).toBe("Correct, well done!");
    });

    it("record_progress without a prior grade_answer this turn returns a tool error and does not persist", async () => {
      const socket = new FakeSocket();
      const recordObjectiveProgress = vi.fn(async () => ({ attempts: 1 }));
      createConversationHandler(socket as never, claims, {
        createLLM: fakeCurriculumLLM([
          [{ type: "tool_call", id: "call-1", name: "record_progress", args: { objectiveId: "obj-1" } }],
          [{ type: "text", text: "Okay." }],
        ]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar: fakeCurriculum(objectives),
        getAvatarById: vi.fn(async () => null),
        recordObjectiveProgress,
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });
      expect(recordObjectiveProgress).not.toHaveBeenCalled();
      expect(findMessages(socket, "checkpoint.result")).toHaveLength(0);
    });

    describe("branching scenario questions", () => {
      const twoStepScenarioObjective: SessionCurriculumObjective = {
        id: "obj-2",
        title: "Handling complaints",
        teachingContent: "Apologize, then escalate if needed.",
        checkQuestion: "unused for scenario objectives",
        gradingCriteria: "unused for scenario objectives",
        status: "NOT_STARTED",
        scenarioSteps: [
          {
            id: "step-1",
            order: 0,
            prompt: "A customer complains about a late delivery. What do you say?",
            branches: [
              { id: "b1", order: 0, matchCriteria: "Apologizes and offers a resolution", nextStepId: "step-2", outcome: null },
            ],
          },
          {
            id: "step-2",
            order: 1,
            prompt: "The customer is still upset. What now?",
            branches: [{ id: "b2", order: 0, matchCriteria: "Escalates to a manager", nextStepId: null, outcome: "PASS" }],
          },
        ],
      };

      const oneStepScenarioObjective: SessionCurriculumObjective = {
        id: "obj-3",
        title: "Simple scenario",
        teachingContent: "T",
        checkQuestion: "unused for scenario objectives",
        gradingCriteria: "unused for scenario objectives",
        status: "NOT_STARTED",
        scenarioSteps: [
          {
            id: "step-1",
            order: 0,
            prompt: "Scenario opening line",
            branches: [{ id: "b1", order: 0, matchCriteria: "resolves it", nextStepId: null, outcome: "PASS" }],
          },
        ],
      };

      it("advance_scenario continues to the next step (in a later turn than start_checkpoint) and sends scenario.step", async () => {
        const socket = new FakeSocket();
        createConversationHandler(socket as never, claims, {
          createLLM: fakeCurriculumLLM([
            [{ type: "tool_call", id: "call-1", name: "start_checkpoint", args: { objectiveId: "obj-2" } }],
            [{ type: "text", text: "A customer complains about a late delivery. What do you say?" }],
            [{ type: "tool_call", id: "call-2", name: "advance_scenario", args: { objectiveId: "obj-2" } }],
            [{ type: "text", text: "The customer is still upset. What now?" }],
          ]),
          createSTT: fakeSTT("success", "I'm sorry, let me fix that for you"),
          createTTS: fakeTTS("success"),
          getCurriculumForAvatar: fakeCurriculum([twoStepScenarioObjective]),
          getAvatarById: vi.fn(async () => null),
          ...noRetrieval,
        });
        socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
        await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));

        socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });
        await vi.waitFor(() => expect(findMessages(socket, "turn.ended")).toHaveLength(1));

        socket.emitMessage({ type: "audio.chunk", utteranceId: "u2", audioBase64: "AAAA", mimeType: "audio/wav" });
        await vi.waitFor(() => expect(findMessages(socket, "turn.ended")).toHaveLength(2));

        expect(findMessages(socket, "scenario.step")).toEqual([
          { type: "scenario.step", objectiveId: "obj-2", stepId: "step-2", prompt: "The customer is still upset. What now?" },
        ]);
      });

      it("advance_scenario resolving a terminal branch feeds record_progress exactly like grade_answer does", async () => {
        const socket = new FakeSocket();
        const recordObjectiveProgress = vi.fn(async () => ({ attempts: 1 }));
        createConversationHandler(socket as never, claims, {
          createLLM: fakeCurriculumLLM([
            [{ type: "tool_call", id: "call-1", name: "start_checkpoint", args: { objectiveId: "obj-3" } }],
            [{ type: "text", text: "Scenario opening line" }],
            [{ type: "tool_call", id: "call-2", name: "advance_scenario", args: { objectiveId: "obj-3" } }],
            [{ type: "tool_call", id: "call-3", name: "record_progress", args: { objectiveId: "obj-3" } }],
            [{ type: "text", text: "Nicely resolved." }],
          ]),
          createSTT: fakeSTT("success", "I apologized and fixed it"),
          createTTS: fakeTTS("success"),
          getCurriculumForAvatar: fakeCurriculum([oneStepScenarioObjective]),
          getAvatarById: vi.fn(async () => null),
          recordObjectiveProgress,
          ...noRetrieval,
        });
        socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
        await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));

        socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });
        await vi.waitFor(() => expect(findMessages(socket, "turn.ended")).toHaveLength(1));

        socket.emitMessage({ type: "audio.chunk", utteranceId: "u2", audioBase64: "AAAA", mimeType: "audio/wav" });
        await vi.waitFor(() => expect(findMessages(socket, "turn.ended")).toHaveLength(2));

        expect(recordObjectiveProgress).toHaveBeenCalledWith("org-1", "obj-3", "user-1", "PASS", "Feedback line.");
        expect(findMessages(socket, "checkpoint.result")).toEqual([
          { type: "checkpoint.result", objectiveId: "obj-3", verdict: "PASS", feedback: "Feedback line.", attempts: 1 },
        ]);
      });

      it("grade_answer rejects a scenario-tagged objective instead of grading it", async () => {
        const socket = new FakeSocket();
        const recordObjectiveProgress = vi.fn(async () => ({ attempts: 1 }));
        createConversationHandler(socket as never, claims, {
          createLLM: fakeCurriculumLLM([
            [{ type: "tool_call", id: "call-1", name: "grade_answer", args: { objectiveId: "obj-3" } }],
            [{ type: "tool_call", id: "call-2", name: "record_progress", args: { objectiveId: "obj-3" } }],
            [{ type: "text", text: "Okay." }],
          ]),
          createSTT: fakeSTT("success"),
          createTTS: fakeTTS("success"),
          getCurriculumForAvatar: fakeCurriculum([oneStepScenarioObjective]),
          getAvatarById: vi.fn(async () => null),
          recordObjectiveProgress,
          ...noRetrieval,
        });
        socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
        await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
        socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

        await vi.waitFor(() => expect(findMessages(socket, "turn.ended")).toHaveLength(1));
        expect(recordObjectiveProgress).not.toHaveBeenCalled();
        expect(findMessages(socket, "checkpoint.result")).toHaveLength(0);
      });

      it("advance_scenario without a prior start_checkpoint in this session returns a tool error and does not advance", async () => {
        const socket = new FakeSocket();
        createConversationHandler(socket as never, claims, {
          createLLM: fakeCurriculumLLM([
            [{ type: "tool_call", id: "call-1", name: "advance_scenario", args: { objectiveId: "obj-2" } }],
            [{ type: "text", text: "Okay." }],
          ]),
          createSTT: fakeSTT("success"),
          createTTS: fakeTTS("success"),
          getCurriculumForAvatar: fakeCurriculum([twoStepScenarioObjective]),
          getAvatarById: vi.fn(async () => null),
          ...noRetrieval,
        });
        socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
        await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
        socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

        await vi.waitFor(() => expect(findMessages(socket, "turn.ended")).toHaveLength(1));
        expect(findMessages(socket, "scenario.step")).toHaveLength(0);
        expect(findMessages(socket, "checkpoint.result")).toHaveLength(0);
      });

      it("MAX_SCENARIO_HOPS force-resolves a self-looping branch graph to RETRY instead of continuing forever", async () => {
        const MAX_SCENARIO_HOPS = 8;
        const loopingObjective: SessionCurriculumObjective = {
          id: "obj-4",
          title: "Looping scenario",
          teachingContent: "T",
          checkQuestion: "unused",
          gradingCriteria: "unused",
          status: "NOT_STARTED",
          scenarioSteps: [
            {
              id: "step-1",
              order: 0,
              prompt: "Loop prompt",
              branches: [{ id: "b1", order: 0, matchCriteria: "anything", nextStepId: "step-1", outcome: null }],
            },
          ],
        };

        const script: LLMStreamEvent[][] = [
          [{ type: "tool_call", id: "call-start", name: "start_checkpoint", args: { objectiveId: "obj-4" } }],
          [{ type: "text", text: "Loop prompt" }],
        ];
        for (let i = 0; i < MAX_SCENARIO_HOPS; i++) {
          script.push([{ type: "tool_call", id: `call-adv-${i}`, name: "advance_scenario", args: { objectiveId: "obj-4" } }]);
          script.push([{ type: "text", text: `Still looping ${i}` }]);
        }
        // The (MAX_SCENARIO_HOPS + 1)th advance_scenario call pushes hops past the limit and
        // force-resolves RETRY — record_progress right after proves it landed in gradedThisTurn.
        script.push([{ type: "tool_call", id: "call-adv-final", name: "advance_scenario", args: { objectiveId: "obj-4" } }]);
        script.push([{ type: "tool_call", id: "call-record", name: "record_progress", args: { objectiveId: "obj-4" } }]);
        script.push([{ type: "text", text: "Let's move on." }]);

        const socket = new FakeSocket();
        const recordObjectiveProgress = vi.fn(async () => ({ attempts: 1 }));
        createConversationHandler(socket as never, claims, {
          createLLM: fakeCurriculumLLM(script),
          createSTT: fakeSTT("success"),
          createTTS: fakeTTS("success"),
          getCurriculumForAvatar: fakeCurriculum([loopingObjective]),
          getAvatarById: vi.fn(async () => null),
          recordObjectiveProgress,
          ...noRetrieval,
        });
        socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
        await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));

        let turnCount = 0;
        // start_checkpoint's turn, then MAX_SCENARIO_HOPS continuing turns, then the
        // force-resolve turn.
        for (let i = 0; i < MAX_SCENARIO_HOPS + 2; i++) {
          turnCount += 1;
          socket.emitMessage({ type: "audio.chunk", utteranceId: `u${turnCount}`, audioBase64: "AAAA", mimeType: "audio/wav" });
          await vi.waitFor(() => expect(findMessages(socket, "turn.ended")).toHaveLength(turnCount));
        }

        expect(findMessages(socket, "scenario.step")).toHaveLength(MAX_SCENARIO_HOPS);
        expect(recordObjectiveProgress).toHaveBeenCalledWith(
          "org-1",
          "obj-4",
          "user-1",
          "RETRY",
          "Let's move on and revisit this later.",
        );
      });
    });

    it("a tool handler that throws degrades to a synthetic error result instead of failing the turn", async () => {
      const socket = new FakeSocket();
      const recordObjectiveProgress = vi.fn(async () => {
        throw new Error("db unavailable");
      });
      createConversationHandler(socket as never, claims, {
        createLLM: fakeCurriculumLLM(
          [
            [{ type: "tool_call", id: "call-1", name: "grade_answer", args: { objectiveId: "obj-1" } }],
            [{ type: "tool_call", id: "call-2", name: "record_progress", args: { objectiveId: "obj-1" } }],
            [{ type: "text", text: "Continuing anyway." }],
          ],
          "PASS",
        ),
        createSTT: fakeSTT("success", "20 days"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar: fakeCurriculum(objectives),
        getAvatarById: vi.fn(async () => null),
        recordObjectiveProgress,
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });
      const avatarTranscript = findMessages(socket, "transcript").find((m) => m.role === "avatar");
      expect(avatarTranscript?.text).toBe("Continuing anyway.");
      expect(findMessages(socket, "checkpoint.result")).toHaveLength(0);
      expect(findMessages(socket, "turn.failed")).toHaveLength(0);
    });

    it("exceeding the max tool round-trips fails the turn instead of looping forever", async () => {
      const socket = new FakeSocket();
      // Every round-trip calls start_checkpoint again — never finishes in
      // plain text — to exercise the round-trip cap.
      const infiniteScript: LLMStreamEvent[][] = Array.from({ length: 10 }, () => [
        { type: "tool_call", id: "call-loop", name: "start_checkpoint", args: { objectiveId: "obj-1" } },
      ]);
      createConversationHandler(socket as never, claims, {
        createLLM: fakeCurriculumLLM(infiniteScript),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar: fakeCurriculum(objectives),
        getAvatarById: vi.fn(async () => null),
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.failed")).toHaveLength(1);
      });
      expect(findMessages(socket, "turn.failed")[0]).toMatchObject({ kind: "llm" });
      expect(findMessages(socket, "turn.ended")).toHaveLength(0);
    });

    it("end_module reports remaining objectives instead of completing when not everything has passed", async () => {
      const socket = new FakeSocket();
      const getRemainingObjectiveTitles = vi.fn(async () => ["Leave basics"]);
      createConversationHandler(socket as never, claims, {
        createLLM: fakeCurriculumLLM([
          [{ type: "tool_call", id: "call-1", name: "end_module", args: {} }],
          [{ type: "text", text: "Let's keep going." }],
        ]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar: fakeCurriculum(objectives),
        getAvatarById: vi.fn(async () => null),
        getRemainingObjectiveTitles,
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });
      expect(findMessages(socket, "module.completed")).toHaveLength(0);
    });

    it("end_module sends module.completed once every objective has passed", async () => {
      const socket = new FakeSocket();
      const getRemainingObjectiveTitles = vi.fn(async () => []);
      createConversationHandler(socket as never, claims, {
        createLLM: fakeCurriculumLLM([
          [{ type: "tool_call", id: "call-1", name: "end_module", args: {} }],
          [{ type: "text", text: "Great work, you're done!" }],
        ]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar: fakeCurriculum(objectives),
        getAvatarById: vi.fn(async () => null),
        getRemainingObjectiveTitles,
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });
      expect(findMessages(socket, "module.completed")).toEqual([{ type: "module.completed", curriculumId: "curr-1" }]);
    });

    it("record_progress in an anonymous (embed) session streams feedback but never persists — tenancy.md's unsigned-write rule", async () => {
      const socket = new FakeSocket();
      const recordObjectiveProgress = vi.fn(async () => ({ attempts: 1 }));
      const anonymousClaims = { orgId: "org-1", userId: null };
      createConversationHandler(socket as never, anonymousClaims, {
        createLLM: fakeCurriculumLLM(
          [
            [{ type: "tool_call", id: "call-1", name: "grade_answer", args: { objectiveId: "obj-1" } }],
            [{ type: "tool_call", id: "call-2", name: "record_progress", args: { objectiveId: "obj-1" } }],
            [{ type: "text", text: "Correct, well done!" }],
          ],
          "PASS",
        ),
        createSTT: fakeSTT("success", "20 days"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar: fakeCurriculum(objectives),
        getAvatarById: vi.fn(async () => null),
        recordObjectiveProgress,
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(recordObjectiveProgress).not.toHaveBeenCalled();
      expect(findMessages(socket, "checkpoint.result")).toEqual([
        { type: "checkpoint.result", objectiveId: "obj-1", verdict: "PASS", feedback: "Feedback line.", attempts: 1 },
      ]);
    });

    it("end_module in an anonymous (embed) session is refused rather than measured against nothing", async () => {
      const socket = new FakeSocket();
      const getRemainingObjectiveTitles = vi.fn(async () => []);
      const anonymousClaims = { orgId: "org-1", userId: null };
      createConversationHandler(socket as never, anonymousClaims, {
        createLLM: fakeCurriculumLLM([
          [{ type: "tool_call", id: "call-1", name: "end_module", args: {} }],
          [{ type: "text", text: "Noted." }],
        ]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar: fakeCurriculum(objectives),
        getAvatarById: vi.fn(async () => null),
        getRemainingObjectiveTitles,
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });
      expect(getRemainingObjectiveTitles).not.toHaveBeenCalled();
      expect(findMessages(socket, "module.completed")).toHaveLength(0);
    });
  });

  describe("adaptive personalization (learner-aware curriculum)", () => {
    it("passes the connecting learner's userId to getCurriculumForAvatar so progress-aware status can be computed", async () => {
      const socket = new FakeSocket();
      const getCurriculumForAvatar = fakeCurriculum([]);
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hi."]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar,
        getAvatarById: vi.fn(async () => null),
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });

      await vi.waitFor(() => {
        expect(socket.sent).toContainEqual({ type: "session.ready" });
      });
      expect(getCurriculumForAvatar).toHaveBeenCalledWith("org-1", "11111111-1111-1111-1111-111111111111", "user-1");
    });

    it("folds each objective's mastery status and last feedback into the system prompt sent to the model", async () => {
      const socket = new FakeSocket();
      let capturedSystemPrompt = "";
      const createLLM = vi.fn((_env, opts) => {
        return {
          name: "fake-llm",
          async *chat(_messages: unknown, chatOpts: { systemPrompt: string }) {
            capturedSystemPrompt = chatOpts.systemPrompt;
            opts?.onResolved?.("fake-gemini");
            yield { type: "text", text: "Let's continue. " } satisfies LLMStreamEvent;
          },
        } as LLMProvider;
      });
      const annotatedObjectives: SessionCurriculumObjective[] = [
        {
          id: "obj-1",
          title: "Leave basics",
          teachingContent: "20 days a year.",
          checkQuestion: "How many days?",
          gradingCriteria: "Answer must say 20 days.",
          scenarioSteps: [],
          status: "MASTERED",
        },
        {
          id: "obj-2",
          title: "Approval process",
          teachingContent: "Manager sign-off required.",
          checkQuestion: "Who approves leave?",
          gradingCriteria: "Answer must say manager.",
          scenarioSteps: [],
          status: "NEEDS_REVIEW",
          lastFeedback: "Missed the manager sign-off step.",
        },
      ];
      createConversationHandler(socket as never, claims, {
        createLLM,
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getCurriculumForAvatar: fakeCurriculum(annotatedObjectives),
        getAvatarById: vi.fn(async () => null),
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });
      expect(capturedSystemPrompt).toMatch(/MASTERED/);
      expect(capturedSystemPrompt).toMatch(/NEEDS_REVIEW/);
      expect(capturedSystemPrompt).toContain("Missed the manager sign-off step.");
    });
  });

  describe("reading level", () => {
    it("resolves readingLevel from the avatar record for a non-pinned session and calls getAvatarById exactly once", async () => {
      const socket = new FakeSocket();
      const getAvatarById = vi.fn(async () => ({
        id: "11111111-1111-1111-1111-111111111111",
        name: "Nancy",
        style: "REALISTIC" as const,
        gender: "FEMALE" as const,
        skinTone: "TONE_2" as const,
        hairStyle: "MEDIUM" as const,
        hairColor: "AUBURN" as const,
        outfit: "BUSINESS_FORMAL" as const,
        expertise: "HR_LEAVE_POLICY" as const,
        voice: "WARM" as const,
        ageGroup: null,
        region: null,
        preferredLanguage: null,
        readingLevel: "SIMPLE" as const,
        status: "ACTIVE" as const,
        simliFaceId: null,
      }));
      let capturedSystemPrompt = "";
      const createLLM = vi.fn((_env, opts) => {
        return {
          name: "fake-llm",
          async *chat(_messages: unknown, chatOpts: { systemPrompt: string }) {
            capturedSystemPrompt = chatOpts.systemPrompt;
            opts?.onResolved?.("fake-gemini");
            yield { type: "text", text: "Hi. " } satisfies LLMStreamEvent;
          },
        } as LLMProvider;
      });
      createConversationHandler(socket as never, claims, {
        createLLM,
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getAvatarById,
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });
      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      // A second turn must not trigger a second avatar lookup — readingLevel
      // is resolved once at session.start, not per turn.
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u2", audioBase64: "AAAA", mimeType: "audio/wav" });
      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(2);
      });

      expect(capturedSystemPrompt).toMatch(/plain language/i);
      expect(getAvatarById).toHaveBeenCalledTimes(1);
      expect(getAvatarById).toHaveBeenCalledWith("org-1", "11111111-1111-1111-1111-111111111111");
    });

    it("degrades to STANDARD wording, without stalling session.ready, when the avatar lookup hangs past its timeout", async () => {
      vi.useFakeTimers();
      try {
        const socket = new FakeSocket();
        const getAvatarById = vi.fn(() => new Promise<never>(() => {})); // never resolves
        createConversationHandler(socket as never, claims, {
          createLLM: fakeLLM("success", ["Hi."]),
          createSTT: fakeSTT("success"),
          createTTS: fakeTTS("success"),
          getAvatarById,
          ...noRetrieval,
        });
        socket.emitMessage({ ...sessionStartBase, avatarId: "11111111-1111-1111-1111-111111111111" });

        await vi.advanceTimersByTimeAsync(250);
        expect(socket.sent).toContainEqual({ type: "session.ready" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("defaults to STANDARD wording when the avatar has no readingLevel set", async () => {
      const socket = new FakeSocket();
      let capturedSystemPrompt = "";
      const createLLM = vi.fn((_env, opts) => {
        return {
          name: "fake-llm",
          async *chat(_messages: unknown, chatOpts: { systemPrompt: string }) {
            capturedSystemPrompt = chatOpts.systemPrompt;
            opts?.onResolved?.("fake-gemini");
            yield { type: "text", text: "Hi. " } satisfies LLMStreamEvent;
          },
        } as LLMProvider;
      });
      createConversationHandler(socket as never, claims, {
        createLLM,
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });
      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(capturedSystemPrompt).toMatch(/clear, professional language/i);
    });
  });

  describe("language", () => {
    it("resolves language from the avatar record for a non-pinned session, overriding the client-sent message.language", async () => {
      const socket = new FakeSocket();
      const createTTS = fakeTTS("success");
      const createSTT = fakeSTT("success");
      const getAvatarById = vi.fn(async () => ({
        id: "33333333-3333-3333-3333-333333333333",
        name: "Nancy",
        style: "REALISTIC" as const,
        gender: "FEMALE" as const,
        skinTone: "TONE_2" as const,
        hairStyle: "MEDIUM" as const,
        hairColor: "AUBURN" as const,
        outfit: "BUSINESS_FORMAL" as const,
        expertise: "HR_LEAVE_POLICY" as const,
        voice: "WARM" as const,
        ageGroup: null,
        region: null,
        preferredLanguage: "SPANISH" as const,
        readingLevel: null,
        status: "ACTIVE" as const,
        simliFaceId: null,
      }));
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hola. "]),
        createSTT,
        createTTS,
        getAvatarById,
        ...noRetrieval,
      });
      // sessionStartBase omits `language`, which defaults to "English" — the
      // avatar's SPANISH preferredLanguage must win anyway.
      socket.emitMessage({ ...sessionStartBase, avatarId: "33333333-3333-3333-3333-333333333333" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(createTTS).toHaveBeenCalledWith("WARM", "FEMALE", "Spanish", process.env, expect.anything());
      const sttInstance = (createSTT as unknown as { mock: { results: { value: STTProvider }[] } }).mock.results[0]!
        .value;
      expect(sttInstance.transcribe).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "audio/wav",
        expect.objectContaining({ language: "es" }),
      );
    });

    it("resolves HINDI from the avatar record the same way (regression)", async () => {
      const socket = new FakeSocket();
      const createTTS = fakeTTS("success");
      const createSTT = fakeSTT("success");
      const getAvatarById = vi.fn(async () => ({
        id: "33333333-3333-3333-3333-333333333333",
        name: "Nancy",
        style: "REALISTIC" as const,
        gender: "FEMALE" as const,
        skinTone: "TONE_2" as const,
        hairStyle: "MEDIUM" as const,
        hairColor: "AUBURN" as const,
        outfit: "BUSINESS_FORMAL" as const,
        expertise: "HR_LEAVE_POLICY" as const,
        voice: "WARM" as const,
        ageGroup: null,
        region: null,
        preferredLanguage: "HINDI" as const,
        readingLevel: null,
        status: "ACTIVE" as const,
        simliFaceId: null,
      }));
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["ठीक है। "]),
        createSTT,
        createTTS,
        getAvatarById,
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "33333333-3333-3333-3333-333333333333" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(createTTS).toHaveBeenCalledWith("WARM", "FEMALE", "Hindi", process.env, expect.anything());
      const sttInstance = (createSTT as unknown as { mock: { results: { value: STTProvider }[] } }).mock.results[0]!
        .value;
      expect(sttInstance.transcribe).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "audio/wav",
        expect.objectContaining({ language: "hi" }),
      );
    });

    it("falls back to message.language when the avatar has no preferredLanguage set", async () => {
      const socket = new FakeSocket();
      const createSTT = fakeSTT("success");
      const getAvatarById = vi.fn(async () => ({
        id: "33333333-3333-3333-3333-333333333333",
        name: "Nancy",
        style: "REALISTIC" as const,
        gender: "FEMALE" as const,
        skinTone: "TONE_2" as const,
        hairStyle: "MEDIUM" as const,
        hairColor: "AUBURN" as const,
        outfit: "BUSINESS_FORMAL" as const,
        expertise: "HR_LEAVE_POLICY" as const,
        voice: "WARM" as const,
        ageGroup: null,
        region: null,
        preferredLanguage: null,
        readingLevel: null,
        status: "ACTIVE" as const,
        simliFaceId: null,
      }));
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["ठीक है। "]),
        createSTT,
        createTTS: fakeTTS("success"),
        getAvatarById,
        ...noRetrieval,
      });
      socket.emitMessage({
        ...sessionStartBase,
        avatarId: "33333333-3333-3333-3333-333333333333",
        language: "Hindi",
      });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      const sttInstance = (createSTT as unknown as { mock: { results: { value: STTProvider }[] } }).mock.results[0]!
        .value;
      expect(sttInstance.transcribe).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "audio/wav",
        expect.objectContaining({ language: "hi" }),
      );
    });

    it("resolves language from the pinned avatar (embed session), ignoring a spoofed client-sent language", async () => {
      const socket = new FakeSocket();
      const createTTS = fakeTTS("success");
      const createSTT = fakeSTT("success");
      const getAvatarById = vi.fn(async () => ({
        id: "avatar-1",
        name: "Pinned Persona",
        style: "REALISTIC" as const,
        gender: "MALE" as const,
        skinTone: "TONE_3" as const,
        hairStyle: "SHORT" as const,
        hairColor: "BLACK" as const,
        outfit: "BUSINESS_CASUAL" as const,
        expertise: "SALES_NEGOTIATION" as const,
        voice: "DEEP" as const,
        ageGroup: null,
        region: null,
        preferredLanguage: "SPANISH" as const,
        readingLevel: null,
        status: "ACTIVE" as const,
        simliFaceId: null,
      }));
      const embedClaims = { orgId: "org-1", userId: null, pinnedAvatarId: "avatar-1" };
      createConversationHandler(socket as never, embedClaims, {
        createLLM: fakeLLM("success", ["Hola. "]),
        createSTT,
        createTTS,
        getAvatarById,
        ...noRetrieval,
      });
      // A malicious/misbehaving embed page spoofs "Hindi" — the pinned
      // avatar's SPANISH preferredLanguage must win regardless.
      socket.emitMessage({
        ...sessionStartBase,
        language: "Hindi",
        avatarId: "22222222-2222-2222-2222-222222222222",
      });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      expect(createTTS).toHaveBeenCalledWith("DEEP", "MALE", "Spanish", process.env, expect.anything());
      const sttInstance = (createSTT as unknown as { mock: { results: { value: STTProvider }[] } }).mock.results[0]!
        .value;
      expect(sttInstance.transcribe).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "audio/wav",
        expect.objectContaining({ language: "es" }),
      );
    });

    it("a session with no avatar at all falls back to message.language / English unchanged", async () => {
      const socket = new FakeSocket();
      const createSTT = fakeSTT("success");
      createConversationHandler(socket as never, claims, {
        createLLM: fakeLLM("success", ["Hi. "]),
        createSTT,
        createTTS: fakeTTS("success"),
        ...noRetrieval,
      });
      socket.emitMessage(sessionStartBase);
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });

      const sttInstance = (createSTT as unknown as { mock: { results: { value: STTProvider }[] } }).mock.results[0]!
        .value;
      expect(sttInstance.transcribe).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "audio/wav",
        expect.objectContaining({ language: "en" }),
      );
    });
  });

  describe("embed sessions (claims.pinnedAvatarId)", () => {
    it("resolves persona fields server-side from the pinned avatar, ignoring client-sent session.start fields", async () => {
      const socket = new FakeSocket();
      const getAvatarById = vi.fn(async () => ({
        id: "avatar-1",
        name: "Pinned Persona",
        style: "REALISTIC" as const,
        gender: "MALE" as const,
        skinTone: "TONE_3" as const,
        hairStyle: "SHORT" as const,
        hairColor: "BLACK" as const,
        outfit: "BUSINESS_CASUAL" as const,
        expertise: "SALES_NEGOTIATION" as const,
        voice: "DEEP" as const,
        ageGroup: null,
        region: null,
        preferredLanguage: null,
        readingLevel: null,
        status: "ACTIVE" as const,
        simliFaceId: null,
      }));
      const embedClaims = { orgId: "org-1", userId: null, pinnedAvatarId: "avatar-1" };
      createConversationHandler(socket as never, embedClaims, {
        createLLM: fakeLLM("success", ["Hi there."]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getAvatarById,
        ...noRetrieval,
      });

      // A malicious/misbehaving embed page could send anything here — none
      // of it should reach the system prompt or TTS voice selection.
      socket.emitMessage({
        ...sessionStartBase,
        avatarName: "Spoofed Name",
        expertise: "IT_TECHNOLOGY",
        voiceTone: "WARM",
        gender: "FEMALE",
        avatarId: "22222222-2222-2222-2222-222222222222",
      });

      await vi.waitFor(() => {
        expect(socket.sent).toContainEqual({ type: "session.ready" });
      });
      expect(getAvatarById).toHaveBeenCalledWith("org-1", "avatar-1");
    });

    it("resolves readingLevel from the pinned avatar without a second avatar lookup", async () => {
      const socket = new FakeSocket();
      const getAvatarById = vi.fn(async () => ({
        id: "avatar-1",
        name: "Pinned Persona",
        style: "REALISTIC" as const,
        gender: "MALE" as const,
        skinTone: "TONE_3" as const,
        hairStyle: "SHORT" as const,
        hairColor: "BLACK" as const,
        outfit: "BUSINESS_CASUAL" as const,
        expertise: "SALES_NEGOTIATION" as const,
        voice: "DEEP" as const,
        ageGroup: null,
        region: null,
        preferredLanguage: null,
        readingLevel: "ADVANCED" as const,
        status: "ACTIVE" as const,
        simliFaceId: null,
      }));
      let capturedSystemPrompt = "";
      const createLLM = vi.fn((_env, opts) => {
        return {
          name: "fake-llm",
          async *chat(_messages: unknown, chatOpts: { systemPrompt: string }) {
            capturedSystemPrompt = chatOpts.systemPrompt;
            opts?.onResolved?.("fake-gemini");
            yield { type: "text", text: "Hi." } satisfies LLMStreamEvent;
          },
        } as LLMProvider;
      });
      const embedClaims = { orgId: "org-1", userId: null, pinnedAvatarId: "avatar-1" };
      createConversationHandler(socket as never, embedClaims, {
        createLLM,
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getAvatarById,
        ...noRetrieval,
      });
      socket.emitMessage({ ...sessionStartBase, avatarId: "22222222-2222-2222-2222-222222222222" });
      await vi.waitFor(() => expect(socket.sent).toContainEqual({ type: "session.ready" }));
      socket.emitMessage({ type: "audio.chunk", utteranceId: "u1", audioBase64: "AAAA", mimeType: "audio/wav" });

      await vi.waitFor(() => {
        expect(findMessages(socket, "turn.ended")).toHaveLength(1);
      });
      expect(capturedSystemPrompt).toMatch(/domain terminology/i);
      expect(getAvatarById).toHaveBeenCalledTimes(1);
    });

    it("loads the curriculum for the pinned avatar, not whatever avatarId the client sent", async () => {
      const socket = new FakeSocket();
      const getAvatarById = vi.fn(async () => null); // avatar lookup miss doesn't block the session
      const getCurriculumForAvatar = fakeCurriculum([]);
      const embedClaims = { orgId: "org-1", userId: null, pinnedAvatarId: "avatar-1" };
      createConversationHandler(socket as never, embedClaims, {
        createLLM: fakeLLM("success", ["Hi."]),
        createSTT: fakeSTT("success"),
        createTTS: fakeTTS("success"),
        getAvatarById,
        getCurriculumForAvatar,
        ...noRetrieval,
      });

      socket.emitMessage({ ...sessionStartBase, avatarId: "22222222-2222-2222-2222-222222222222" });

      await vi.waitFor(() => {
        expect(socket.sent).toContainEqual({ type: "session.ready" });
      });
      expect(getCurriculumForAvatar).toHaveBeenCalledWith("org-1", "avatar-1", null);
    });
  });
});
