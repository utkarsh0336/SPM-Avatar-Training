import type { WebSocket, RawData } from "ws";
import {
  buildSystemPrompt,
  createLLMProviderFromEnv,
  createSTTProviderFromEnv,
  createTTSProviderFromEnv,
  createTurnLatencyTracker,
  SentenceChunker,
  clientMessageSchema,
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
  type LLMMessage,
  type LLMProvider,
  type STTProvider,
  type VoiceTone,
} from "@avatrain/shared";
import type { WsTicketClaims } from "../lib/ws-tickets.js";

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
  _claims: WsTicketClaims,
  deps: ConversationHandlerDeps = {},
): void {
  const createLLM = deps.createLLM ?? createLLMProviderFromEnv;
  const createSTT = deps.createSTT ?? createSTTProviderFromEnv;
  const createTTS = deps.createTTS ?? createTTSProviderFromEnv;
  const messages: LLMMessage[] = [];

  let llm: LLMProvider | null = null;
  let stt: STTProvider | null = null;
  let systemPrompt = "";
  let voiceTone: VoiceTone = "NEUTRAL";
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
      const text = await stt.transcribe(bytes, mimeType);
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
    const sentenceTts = createTTS(voiceTone, process.env, {
      onResolved: (name, mimeType) => {
        resolvedMimeType = mimeType;
        onServed(name);
      },
    });
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of sentenceTts.synthesize(sentenceText, "", { signal })) {
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
        systemPrompt,
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
    send({ type: "transcript", role: "avatar", text: fullReply, utteranceId, final: true });
    send({ type: "turn.ended", utteranceId });
    currentUtteranceId = null;

    const latency = tracker.finish({ llm: currentTurnLlmServedBy, stt: sttProvider, tts: lastServedByTts });
    send({
      type: "latency",
      utteranceId,
      sttMs: latency.sttMs,
      llmFirstTokenMs: latency.llmFirstTokenMs,
      ttsFirstChunkMs: latency.ttsFirstChunkMs,
      totalMs: latency.totalMs,
      servedBy: latency.servedBy,
    });
  }

  async function handleClientMessage(message: ClientMessage): Promise<void> {
    switch (message.type) {
      case "session.start": {
        systemPrompt = buildSystemPrompt({ avatarName: message.avatarName, expertise: message.expertise });
        voiceTone = message.voiceTone;
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
