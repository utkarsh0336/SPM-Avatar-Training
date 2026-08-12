import type { WebSocket, RawData } from "ws";
import {
  appendKnowledgeContext,
  buildSystemPrompt,
  createLLMProviderFromEnv,
  createSTTProviderFromEnv,
  createTTSProviderFromEnv,
  createTurnLatencyTracker,
  SentenceChunker,
  clientMessageSchema,
  resolveVoiceGender,
  resolveWhisperLanguageCode,
  serverMessageSchema,
  type ClientMessage,
  type KnowledgeSource,
  type ServerMessage,
  type Gender,
  type Language,
  type LLMMessage,
  type LLMProvider,
  type STTProvider,
  type VoiceTone,
} from "@avatrain/shared";
import type { WsTicketClaims } from "../lib/ws-tickets.js";
import { retrieveContext, toKnowledgeSources } from "./retrieval-service.js";

// docs/ARCHITECTURE.md §5's retrieval budget ("<100ms p95 ... or it needs a
// filler utterance") — this pipeline has no filler-utterance mechanism, so
// instead: bound the wait so a hung embedding call or DB query can't stall
// a turn indefinitely. Set a couple times the p95 target, not "however long
// we can afford" — latency-auditor flagged an earlier 800ms value as far
// too loose (most of a mediated-mode turn's entire TTFA budget on its own);
// this is a circuit breaker for pathological cases, not slack to lean on.
const RETRIEVAL_TIMEOUT_MS = 250;

// Rolling window, not a wire-level cap — bounds LLM prompt size (and
// therefore per-turn Gemini/Groq latency) so it stays flat across a long
// session instead of growing turn over turn.
const MAX_HISTORY_MESSAGES = 20;

const WS_OPEN = 1;

interface ResolvedUserText {
  text: string;
  sttProvider?: string;
}

interface SynthesizedSentence {
  text: string;
  audio: Uint8Array;
  mimeType: string;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export interface ConversationHandlerDeps {
  /** Injectable for tests; defaults to the real @avatrain/shared factory. */
  createLLM?: typeof createLLMProviderFromEnv;
  /** Injectable for tests; defaults to the real @avatrain/shared factory. */
  createSTT?: typeof createSTTProviderFromEnv;
  /** Injectable for tests; defaults to the real @avatrain/shared factory. */
  createTTS?: typeof createTTSProviderFromEnv;
  /** Injectable for tests; defaults to the real ./retrieval-service.js. */
  retrieveContext?: typeof retrieveContext;
}

/**
 * Races `promise` against a timeout that resolves to `[]` rather than
 * rejecting — a slow/hung retrieval degrades to "nothing retrieved"
 * (Priority-3 territory), not a turn failure. See RETRIEVAL_TIMEOUT_MS.
 * Logs on timeout — apps/api runs Fastify({logger:false}), so console.error
 * is the only record of a retrieval that's silently degrading turns to
 * ungrounded generation; see knowledge-management.md's Realtime Changes §8.
 */
function withRetrievalTimeout<T>(promise: Promise<T[]>, timeoutMs: number): Promise<T[]> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error(`knowledge retrieval exceeded ${timeoutMs}ms — degrading turn to ungrounded generation`);
      resolve([]);
    }, timeoutMs);
    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      () => {
        clearTimeout(timer);
        resolve([]);
      },
    );
  });
}

/**
 * Per-connection conversation orchestrator: buffered utterance audio (or a
 * client-side Web Speech fallback text) -> STTProvider -> LLMProvider
 * (streamed, sentence-chunked) -> TTSProvider per sentence, sent back to
 * the client strictly in sentence order. One instance per WS connection —
 * `messages` history and the in-flight AbortController live for the
 * connection's lifetime, matching the WS protocol in
 * packages/shared/src/realtime/ws-messages.ts.
 */
export function createConversationHandler(
  socket: WebSocket,
  claims: WsTicketClaims,
  deps: ConversationHandlerDeps = {},
): void {
  const createLLM = deps.createLLM ?? createLLMProviderFromEnv;
  const createSTT = deps.createSTT ?? createSTTProviderFromEnv;
  const createTTS = deps.createTTS ?? createTTSProviderFromEnv;
  const retrieveKnowledge = deps.retrieveContext ?? retrieveContext;
  const messages: LLMMessage[] = [];

  let llm: LLMProvider | null = null;
  let stt: STTProvider | null = null;
  let systemPrompt = "";
  let voiceTone: VoiceTone = "NEUTRAL";
  let gender: Gender = "FEMALE";
  let language: Language = "English";
  let currentUtteranceId: string | null = null;
  let currentAbortController: AbortController | null = null;
  let currentTurnLlmServedBy: string | undefined;

  function send(message: ServerMessage): void {
    if (socket.readyState !== WS_OPEN) return;
    socket.send(JSON.stringify(serverMessageSchema.parse(message)));
  }

  async function getUserTextFromAudio(
    utteranceId: string,
    audioBase64: string,
    mimeType: string,
  ): Promise<ResolvedUserText | null> {
    if (!stt) {
      send({ type: "stt.failed", utteranceId, retryable: false });
      return null;
    }
    try {
      const bytes = Buffer.from(audioBase64, "base64");
      const text = await stt.transcribe(bytes, mimeType, { language: resolveWhisperLanguageCode(language) });
      return { text, sttProvider: stt.name };
    } catch {
      send({ type: "stt.failed", utteranceId, retryable: true });
      return null;
    }
  }

  async function synthesizeSentence(
    sentenceText: string,
    signal: AbortSignal,
    isFirst: boolean,
    tracker: ReturnType<typeof createTurnLatencyTracker>,
    onServed: (name: string) => void,
  ): Promise<SynthesizedSentence | null> {
    let resolvedMimeType = "audio/wav";
    // A fresh failover-wrapped provider per sentence (cheap — no I/O at
    // construction) rather than one shared instance for the whole turn, so
    // each sentence's own onResolved captures ITS OWN served-by/mimeType
    // without racing concurrently in-flight sentences against each other.
    const sentenceTts = createTTS(voiceTone, gender, language, process.env, {
      onResolved: (name, mimeType) => {
        resolvedMimeType = mimeType;
        onServed(name);
      },
    });
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of sentenceTts.synthesize(sentenceText, "", {
        signal,
        voiceGender: resolveVoiceGender(gender),
      })) {
        chunks.push(chunk);
      }
      if (chunks.length === 0) return null;
      if (isFirst) tracker.markTtsFirstChunk();
      return { text: sentenceText, audio: concatUint8Arrays(chunks), mimeType: resolvedMimeType };
    } catch {
      return null;
    }
  }

  async function processTurn(
    utteranceId: string,
    resolveUserText: () => Promise<ResolvedUserText | null>,
  ): Promise<void> {
    if (!llm) return; // session.start never arrived
    const tracker = createTurnLatencyTracker(utteranceId);

    const resolved = await resolveUserText();
    tracker.markSttDone();
    if (!resolved) return; // stt.failed already sent by the resolver
    const { text, sttProvider } = resolved;
    if (!text.trim()) return; // nothing meaningful to respond to

    messages.push({ role: "user", content: text });
    if (messages.length > MAX_HISTORY_MESSAGES) messages.splice(0, messages.length - MAX_HISTORY_MESSAGES);
    send({ type: "transcript", role: "user", text, utteranceId, final: true });

    currentUtteranceId = utteranceId;
    const controller = new AbortController();
    currentAbortController = controller;
    currentTurnLlmServedBy = undefined;
    send({ type: "turn.started", utteranceId });

    // Retrieval-augmented grounding (SOW §3.3) — embed the learner's own
    // utterance, look up the org's most relevant KnowledgeChunks, and fold
    // them into THIS turn's system prompt only (never persisted into the
    // rolling `messages` history, since retrieval is query-dependent).
    // Failure or timeout degrades to the ungrounded Priority-3 path rather
    // than failing the turn — see .claude/rules/realtime.md "degrade,
    // never drop" and .claude/specs/knowledge-management.md.
    const retrievedChunks = await withRetrievalTimeout(
      retrieveKnowledge(claims.orgId, text).catch((error: unknown) => {
        console.error("knowledge retrieval failed — degrading turn to ungrounded generation", error);
        return [];
      }),
      RETRIEVAL_TIMEOUT_MS,
    );
    tracker.markRetrievalDone();
    const turnSystemPrompt = appendKnowledgeContext(systemPrompt, retrievedChunks);
    const sources: KnowledgeSource[] = toKnowledgeSources(retrievedChunks);

    const chunker = new SentenceChunker();
    const sentencePromises: Promise<SynthesizedSentence | null>[] = [];
    let lastServedByTts: string | undefined;
    let firstLlmTokenSeen = false;
    let fullReply = "";
    let llmFailed = false;

    function enqueueSentence(sentenceText: string): void {
      const index = sentencePromises.length;
      sentencePromises.push(
        synthesizeSentence(sentenceText, controller.signal, index === 0, tracker, (name) => {
          lastServedByTts = name;
        }),
      );
    }

    try {
      for await (const delta of llm.chat(messages, {
        systemPrompt: turnSystemPrompt,
        signal: controller.signal,
        // onResolved for LLM is bound once at session.start (see below) and
        // writes into currentTurnLlmServedBy — safe here since only one
        // llm.chat() call is ever in flight per connection at a time.
      })) {
        if (controller.signal.aborted) break;
        if (!firstLlmTokenSeen) {
          firstLlmTokenSeen = true;
          tracker.markLlmFirstToken();
        }
        fullReply += delta;
        for (const sentence of chunker.push(delta)) enqueueSentence(sentence);
      }
      if (!controller.signal.aborted) {
        const trailing = chunker.flush();
        if (trailing) enqueueSentence(trailing);
      }
    } catch {
      llmFailed = true;
    }

    if (llmFailed) {
      if (!controller.signal.aborted) {
        send({
          type: "turn.failed",
          utteranceId,
          kind: "llm",
          message: "The AI tutor is temporarily unavailable. Please try again in a moment.",
        });
      }
      currentUtteranceId = null;
      return;
    }

    if (controller.signal.aborted) {
      currentUtteranceId = null;
      return; // turn.cancelled was already sent by the barge_in handler
    }

    let anySentenceSucceeded = false;
    for (let i = 0; i < sentencePromises.length; i++) {
      if (controller.signal.aborted) break;
      const result = await sentencePromises[i];
      if (!result) continue;
      anySentenceSucceeded = true;
      send({
        type: "tts.chunk",
        utteranceId,
        sentenceIndex: i,
        text: result.text,
        audioBase64: Buffer.from(result.audio).toString("base64"),
        mimeType: result.mimeType,
        isLastForUtterance: i === sentencePromises.length - 1,
      });
    }

    if (controller.signal.aborted) {
      currentUtteranceId = null;
      return;
    }

    if (sentencePromises.length > 0 && !anySentenceSucceeded) {
      send({
        type: "turn.failed",
        utteranceId,
        kind: "tts",
        message: "The AI tutor's voice is temporarily unavailable. Please try again in a moment.",
      });
      currentUtteranceId = null;
      return;
    }

    messages.push({ role: "assistant", content: fullReply });
    send({
      type: "transcript",
      role: "avatar",
      text: fullReply,
      utteranceId,
      final: true,
      // Omitted (not []) when ungrounded — matches transcriptMessageSchema's
      // documented contract for a Priority-3 reply.
      ...(sources.length > 0 ? { sources } : {}),
    });
    send({ type: "turn.ended", utteranceId });
    currentUtteranceId = null;

    const latency = tracker.finish({ llm: currentTurnLlmServedBy, stt: sttProvider, tts: lastServedByTts });
    send({
      type: "latency",
      utteranceId,
      sttMs: latency.sttMs,
      retrievalMs: latency.retrievalMs,
      llmFirstTokenMs: latency.llmFirstTokenMs,
      ttsFirstChunkMs: latency.ttsFirstChunkMs,
      totalMs: latency.totalMs,
      servedBy: latency.servedBy,
    });
  }

  async function handleClientMessage(message: ClientMessage): Promise<void> {
    switch (message.type) {
      case "session.start": {
        language = message.language;
        systemPrompt = buildSystemPrompt({
          avatarName: message.avatarName,
          expertise: message.expertise,
          language,
        });
        voiceTone = message.voiceTone;
        gender = message.gender;
        llm = createLLM(process.env, {
          onResolved: (name) => {
            currentTurnLlmServedBy = name;
          },
        });
        stt = createSTT(process.env);
        send({ type: "session.ready" });
        break;
      }
      case "audio.chunk":
        await processTurn(message.utteranceId, () =>
          getUserTextFromAudio(message.utteranceId, message.audioBase64, message.mimeType),
        );
        break;
      case "text.fallback":
        await processTurn(message.utteranceId, async () => ({ text: message.text }));
        break;
      case "barge_in":
        if (currentUtteranceId === message.utteranceId) {
          currentAbortController?.abort();
          send({ type: "turn.cancelled", utteranceId: message.utteranceId });
        }
        break;
      case "session.end":
        socket.close();
        break;
    }
  }

  socket.on("message", (raw: RawData) => {
    let parsed: ClientMessage;
    try {
      parsed = clientMessageSchema.parse(JSON.parse(raw.toString()));
    } catch {
      send({ type: "error", code: "invalid_message" });
      return;
    }
    void handleClientMessage(parsed);
  });

  socket.on("close", () => {
    currentAbortController?.abort();
  });
}
