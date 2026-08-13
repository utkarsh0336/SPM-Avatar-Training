import type { WebSocket, RawData } from "ws";
import {
  appendCurriculumContext,
  appendKnowledgeContext,
  buildSystemPrompt,
  createLLMProviderFromEnv,
  createSTTProviderFromEnv,
  createTTSProviderFromEnv,
  createTurnLatencyTracker,
  CURRICULUM_TOOLS,
  SentenceChunker,
  classifyEmotion,
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
  type LLMStreamEvent,
  type ObjectiveProgressVerdict,
  type STTProvider,
  type VoiceTone,
} from "@avatrain/shared";
import type { WsTicketClaims } from "../lib/ws-tickets.js";
import { retrieveContext, toKnowledgeSources } from "./retrieval-service.js";
import {
  getCurriculumForAvatar,
  getRemainingObjectiveTitles,
  recordObjectiveProgress,
  type SessionCurriculum,
  type SessionCurriculumObjective,
} from "./curriculum-service.js";
import { getAvatarById } from "./avatar-service.js";

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

// Bounds the checkpoint/grading tool loop (see
// .claude/specs/interactive-assessment.md) — a pathological loop (the model
// repeatedly calling tools without ever finishing in text) fails the turn
// with turn.failed rather than hanging it. Each individual tool call is
// separately bounded by TOOL_TIMEOUT_MS, matching
// docs/ARCHITECTURE.md §2's "Tool timeout (>4s) -> tell the model the tool
// failed" failure-table row and docs/ROADMAP.md Phase 3's "Tool p95 <
// 400ms" exit criterion, with headroom for the grading judge's own LLM call.
const MAX_TOOL_ROUNDTRIPS = 4;
const TOOL_TIMEOUT_MS = 3000;

// Same reasoning as RETRIEVAL_TIMEOUT_MS, applied to session.start's
// curriculum lookup — latency-auditor flagged this bootstrap DB round trip
// as unbounded and sitting directly ahead of session.ready. Bounded rather
// than left to however long two sequential Prisma queries happen to take.
const CURRICULUM_LOAD_TIMEOUT_MS = 500;

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

interface GradeResult {
  verdict: ObjectiveProgressVerdict;
  feedback: string;
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
  /** Injectable for tests; defaults to the real ./curriculum-service.js. */
  getCurriculumForAvatar?: typeof getCurriculumForAvatar;
  /** Injectable for tests; defaults to the real ./curriculum-service.js. */
  recordObjectiveProgress?: typeof recordObjectiveProgress;
  /** Injectable for tests; defaults to the real ./curriculum-service.js. */
  getRemainingObjectiveTitles?: typeof getRemainingObjectiveTitles;
  /** Injectable for tests; defaults to the real ./avatar-service.js. Only called when claims.pinnedAvatarId is set (embed sessions). */
  getAvatarById?: typeof getAvatarById;
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
 * Races a tool handler against TOOL_TIMEOUT_MS AND the turn's own abort
 * signal, resolving to a synthetic error string rather than rejecting — a
 * slow/broken tool degrades to "the model is told this call failed" (it
 * can apologise and continue in speech), never a turn failure. Mirrors
 * withRetrievalTimeout's shape. Racing the signal too (not just the timer)
 * is load-bearing: without it, a barge-in mid-tool-call couldn't be
 * noticed until the full timeout elapsed — latency-auditor flagged the
 * original version for this. The underlying `promise` itself isn't
 * cancelled (Prisma has no cheap cancellation here, and every DB write a
 * tool makes is an idempotent upsert), it's just no longer awaited; each
 * tool handler's own send() calls check the signal before dispatching, so
 * a late resolution after abort never reaches the client.
 */
function withToolTimeout(promise: Promise<string>, timeoutMs: number, signal: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error(`conversation-service: tool call exceeded ${timeoutMs}ms — telling the model it failed`);
      resolve("error: tool timed out");
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve("error: turn was cancelled");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (result) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        console.error("conversation-service: tool handler threw", error);
        resolve("error: tool failed");
      },
    );
  });
}

/**
 * Same shape as withRetrievalTimeout, applied to session.start's curriculum
 * lookup — degrades to "no curriculum this session" on timeout/failure
 * rather than delaying session.ready indefinitely.
 */
function withCurriculumTimeout(promise: Promise<SessionCurriculum | null>, timeoutMs: number): Promise<SessionCurriculum | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error(`conversation-service: curriculum lookup exceeded ${timeoutMs}ms — starting session without it`);
      resolve(null);
    }, timeoutMs);
    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        console.error("conversation-service: failed to load curriculum for avatar", error);
        resolve(null);
      },
    );
  });
}

function extractObjectiveId(args: unknown): string | undefined {
  const objectiveId = (args as { objectiveId?: unknown } | undefined)?.objectiveId;
  return typeof objectiveId === "string" ? objectiveId : undefined;
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
  const loadCurriculum = deps.getCurriculumForAvatar ?? getCurriculumForAvatar;
  const persistProgress = deps.recordObjectiveProgress ?? recordObjectiveProgress;
  const remainingObjectiveTitles = deps.getRemainingObjectiveTitles ?? getRemainingObjectiveTitles;
  const loadAvatarById = deps.getAvatarById ?? getAvatarById;
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
  // Loaded once at session.start (see the handleClientMessage case below) —
  // null whenever session.start omitted avatarId, or that avatar has no
  // Curriculum (or one with zero objectives) authored yet. Every tool-loop
  // code path below no-ops gracefully on null, so an ordinary session
  // behaves exactly as it did before this feature existed.
  let curriculum: SessionCurriculum | null = null;

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

  /**
   * grade_answer's judge call — a second, independent LLM invocation (same
   * factory, no new provider config; see
   * .claude/specs/interactive-assessment.md) that grades `answerText`
   * against the objective's own gradingCriteria. Deliberately NOT the
   * model's own self-report: the primary tutoring model could hallucinate
   * a PASS, so the server derives the real verdict itself, matching
   * .claude/rules/tenancy.md's "server re-checks... rather than trusting
   * model arguments" rule.
   */
  async function gradeAnswerWithJudge(
    objective: SessionCurriculumObjective,
    answerText: string,
    signal: AbortSignal,
  ): Promise<GradeResult> {
    const judge = createLLM(process.env, {});
    const judgeSystemPrompt = `You are grading a learner's spoken answer to a training check question. Respond with EXACTLY two lines: the first line is either "VERDICT: PASS" or "VERDICT: RETRY", the second line is one short sentence of feedback for the learner.

Check question: ${objective.checkQuestion}
Grading criteria: ${objective.gradingCriteria}`;

    let raw = "";
    for await (const event of judge.chat([{ role: "user", content: answerText }], {
      systemPrompt: judgeSystemPrompt,
      signal,
    })) {
      if (event.type === "text") raw += event.text;
    }

    const verdict: ObjectiveProgressVerdict = /VERDICT:\s*PASS/i.test(raw) ? "PASS" : "RETRY";
    const feedbackLine = raw
      .split("\n")
      .find((line) => !/^\s*VERDICT:/i.test(line))
      ?.trim();
    return { verdict, feedback: feedbackLine || (verdict === "PASS" ? "Correct." : "Not quite — try again.") };
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

    // Sends any sentences enqueued so far that haven't been sent yet, in
    // order. Called both mid-loop (right before a tool call executes, so
    // audio already spoken before that call isn't held hostage behind the
    // tool round-trip — latency-auditor flagged the original version, which
    // deferred every send until the entire (possibly multi-round-trip)
    // tool loop finished) and once at the very end. isFinal controls
    // whether the LAST sentence sent in this call gets isLastForUtterance —
    // only true once the whole turn is known to be over; an intermediate
    // flush can never claim that, since more sentences may still follow a
    // later round-trip.
    let sentSentenceCount = 0;
    let anySentenceSucceeded = false;
    async function flushSentSentences(isFinal: boolean): Promise<void> {
      while (sentSentenceCount < sentencePromises.length) {
        if (controller.signal.aborted) return;
        const index = sentSentenceCount;
        const result = await sentencePromises[index];
        sentSentenceCount += 1;
        if (!result) continue;
        anySentenceSucceeded = true;
        send({
          type: "tts.chunk",
          utteranceId,
          sentenceIndex: index,
          text: result.text,
          audioBase64: Buffer.from(result.audio).toString("base64"),
          mimeType: result.mimeType,
          isLastForUtterance: isFinal && index === sentencePromises.length - 1,
        });
      }
    }

    // Checkpoint/grading tool dispatcher — see
    // .claude/specs/interactive-assessment.md's Realtime Changes.
    // gradedThisTurn is turn-scoped (fresh per processTurn call, unlike
    // `curriculum` itself): record_progress may only fire for an
    // objectiveId this SAME turn already graded, never a stale/earlier
    // turn's result. start_checkpoint (asking the question) and
    // grade_answer (grading the learner's answer) are necessarily
    // different turns in a real spoken conversation — grade_answer/
    // record_progress pairing within one turn is what's enforced, not a
    // requirement that start_checkpoint happened in this same turn too.
    const gradedThisTurn = new Map<string, GradeResult>();

    async function runTool(event: Extract<LLMStreamEvent, { type: "tool_call" }>): Promise<string> {
      if (!curriculum) return "error: no curriculum is attached to this session";
      const objectiveId = extractObjectiveId(event.args);

      switch (event.name) {
        case "start_checkpoint": {
          const objective = curriculum.objectives.find((o) => o.id === objectiveId);
          if (!objective) return "error: unknown objectiveId";
          if (!controller.signal.aborted) {
            send({ type: "checkpoint.started", objectiveId: objective.id, objectiveTitle: objective.title });
          }
          return "ok: checkpoint started, now ask the check question";
        }
        case "grade_answer": {
          const objective = curriculum.objectives.find((o) => o.id === objectiveId);
          if (!objective) return "error: unknown objectiveId";
          const result = await gradeAnswerWithJudge(objective, text, controller.signal);
          gradedThisTurn.set(objective.id, result);
          return `verdict: ${result.verdict}; feedback: ${result.feedback}`;
        }
        case "record_progress": {
          const graded = objectiveId ? gradedThisTurn.get(objectiveId) : undefined;
          if (!objectiveId || !graded) {
            return "error: call grade_answer for this objective in this same turn before recording progress";
          }
          // .claude/rules/tenancy.md: "Unsigned (anonymous) identity may
          // never write to ObjectiveProgress." Embed sessions (claims.userId
          // null) still get the grading feedback streamed for UX — it just
          // never persists, so it won't survive a refresh and end_module
          // (below) can't measure completion against it.
          if (!claims.userId) {
            if (!controller.signal.aborted) {
              send({ type: "checkpoint.result", objectiveId, verdict: graded.verdict, feedback: graded.feedback, attempts: 1 });
            }
            return "ok: progress noted for this turn (not persisted — anonymous session)";
          }
          const { attempts } = await persistProgress(
            claims.orgId,
            objectiveId,
            claims.userId,
            graded.verdict,
            graded.feedback,
          );
          if (!controller.signal.aborted) {
            send({ type: "checkpoint.result", objectiveId, verdict: graded.verdict, feedback: graded.feedback, attempts });
          }
          return "ok: progress recorded";
        }
        case "end_module": {
          if (!claims.userId) {
            return "error: module completion tracking isn't available in this anonymous session";
          }
          const remaining = await remainingObjectiveTitles(claims.orgId, curriculum.curriculumId, claims.userId);
          if (remaining.length > 0) return `error: objectives not yet passed: ${remaining.join(", ")}`;
          if (!controller.signal.aborted) send({ type: "module.completed", curriculumId: curriculum.curriculumId });
          return "ok: module completed";
        }
        default:
          return `error: unknown tool ${event.name}`;
      }
    }

    // Turn-scoped extension of `messages` for tool round-trips — never
    // written back into the persisted rolling history, since a tool call
    // and its result are meaningful only within this one turn.
    const toolRoundTripMessages: LLMMessage[] = [];
    let roundTrips = 0;
    let sawToolCall = true; // always run the loop body at least once

    while (sawToolCall) {
      roundTrips += 1;
      sawToolCall = false;
      if (roundTrips > MAX_TOOL_ROUNDTRIPS) {
        llmFailed = true;
        break;
      }

      try {
        for await (const event of llm.chat([...messages, ...toolRoundTripMessages], {
          systemPrompt: turnSystemPrompt,
          signal: controller.signal,
          tools: curriculum ? CURRICULUM_TOOLS : undefined,
        })) {
          if (controller.signal.aborted) break;
          if (event.type === "text") {
            if (!firstLlmTokenSeen) {
              firstLlmTokenSeen = true;
              tracker.markLlmFirstToken();
            }
            fullReply += event.text;
            for (const sentence of chunker.push(event.text)) enqueueSentence(sentence);
          } else {
            sawToolCall = true;
            // Flush whatever's already been spoken before spending time on
            // the tool call itself — see flushSentSentences's doc comment.
            await flushSentSentences(false);
            const resultText = await withToolTimeout(runTool(event), TOOL_TIMEOUT_MS, controller.signal);
            toolRoundTripMessages.push({
              role: "assistant",
              content: "",
              toolCalls: [{ id: event.id, name: event.name, args: event.args }],
            });
            toolRoundTripMessages.push({ role: "tool", content: resultText, toolCallId: event.id });
          }
        }
      } catch {
        llmFailed = true;
        break;
      }

      if (controller.signal.aborted) break;
    }

    if (!llmFailed && !controller.signal.aborted) {
      const trailing = chunker.flush();
      if (trailing) enqueueSentence(trailing);
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

    await flushSentSentences(true);

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
    // Computed once from the already-assembled reply text — no extra model
    // call, no added turn latency. See tutor/emotion.ts. Always set
    // (including "neutral"), unlike `sources` below — the client needs an
    // explicit "neutral" to fade a PREVIOUS turn's expression back out; an
    // omitted field would otherwise leave that expression stuck on-screen
    // through every subsequent neutral reply.
    const emotion = classifyEmotion(fullReply);
    send({
      type: "transcript",
      role: "avatar",
      text: fullReply,
      utteranceId,
      final: true,
      // Omitted (not []) when ungrounded — matches transcriptMessageSchema's
      // documented contract for a Priority-3 reply.
      ...(sources.length > 0 ? { sources } : {}),
      emotion,
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

        let avatarName = message.avatarName;
        let expertise = message.expertise;
        let resolvedVoiceTone = message.voiceTone;
        let resolvedGender = message.gender;
        let effectiveAvatarId = message.avatarId;

        // Embed sessions (claims.pinnedAvatarId set by routes/embed.ts's
        // ticket mint) never trust client-supplied persona fields — an
        // anonymous visitor on a third-party page could otherwise send an
        // arbitrary system-prompt-shaping payload. Same trust posture
        // getCallerSimliFaceId already applies to simliFaceId: resolved
        // server-side from the org's own data, once per session.start.
        if (claims.pinnedAvatarId) {
          const pinned = await loadAvatarById(claims.orgId, claims.pinnedAvatarId);
          if (pinned) {
            avatarName = pinned.name ?? avatarName;
            expertise = pinned.expertise ?? expertise;
            resolvedVoiceTone = pinned.voice ?? resolvedVoiceTone;
            resolvedGender = pinned.gender ?? resolvedGender;
          }
          effectiveAvatarId = claims.pinnedAvatarId;
        }

        systemPrompt = buildSystemPrompt({ avatarName, expertise, language });
        voiceTone = resolvedVoiceTone;
        gender = resolvedGender;
        llm = createLLM(process.env, {
          onResolved: (name) => {
            currentTurnLlmServedBy = name;
          },
        });
        stt = createSTT(process.env);

        if (effectiveAvatarId) {
          curriculum = await withCurriculumTimeout(
            loadCurriculum(claims.orgId, effectiveAvatarId),
            CURRICULUM_LOAD_TIMEOUT_MS,
          );
          if (curriculum) systemPrompt = appendCurriculumContext(systemPrompt, curriculum.objectives);
        }

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
