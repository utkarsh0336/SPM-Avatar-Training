import {
  clientMessageSchema,
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
  type SessionStartMessage,
  type TranscriptMessage,
} from "@avatrain/shared/ws";
import { base64ToArrayBuffer, blobToBase64 } from "./base64-audio.js";
import { encodeBlobAsWav } from "./audio-blob-to-wav.js";
import { createAudioTrackFromBytes } from "./audio-track-from-bytes.js";
import { startVoiceActivityDetector } from "./voice-activity-detector.js";
import { createBargeInController } from "./barge-in-controller.js";
import { recognizeOnce as defaultRecognizeOnce } from "./web-speech-fallback.js";

export type ConversationSessionStatus = "connecting" | "listening" | "thinking" | "speaking" | "error" | "ended";

export interface ConversationTranscriptEntry {
  utteranceId: string;
  role: "user" | "avatar";
  text: string;
  final: boolean;
}

export interface ConversationLatencyEvent {
  utteranceId: string;
  sttMs?: number;
  llmFirstTokenMs?: number;
  ttsFirstChunkMs?: number;
  totalMs: number;
  servedBy?: { llm?: string; stt?: string; tts?: string };
}

/**
 * The checkpoint/grading tool loop's client-visible events — see
 * .claude/specs/interactive-assessment.md. Declared locally (own shape,
 * not the raw parsed ServerMessage variant) for the same decoupling reason
 * as ConversationTranscriptEntry/ConversationLatencyEvent above. Only ever
 * fire for a session whose sessionConfig.avatarId resolved to an avatar
 * with a Curriculum attached; absent entirely otherwise.
 */
export interface ConversationCheckpointStartedEvent {
  objectiveId: string;
  objectiveTitle: string;
}

export interface ConversationCheckpointResultEvent {
  objectiveId: string;
  verdict: "PASS" | "RETRY";
  feedback: string;
  attempts: number;
}

export interface ConversationModuleCompletedEvent {
  curriculumId: string;
}

/**
 * Minimal structural subset of packages/avatar-core's AvatarProvider —
 * declared locally rather than imported so this package stays decoupled
 * from a specific avatar implementation, matching the existing pattern
 * (the old voice-avatar-session.ts took raw video/audio elements rather
 * than importing avatar-core). Any real AvatarProvider satisfies this.
 */
export interface ConversationAvatarSink {
  speak(audioTrack: MediaStreamTrack, subtitleText: string): void;
  interrupt(): void;
  /**
   * Optional — only the VRM avatar provider implements this today (Mock has
   * no face by design, Simli's face is vendor-driven). Called for a
   * role:"avatar" transcript that carries an emotion; never for role:"user".
   */
  setEmotion?(emotion: NonNullable<TranscriptMessage["emotion"]>): void;
  /**
   * Optional — only the VRM avatar provider implements this today (Mock/Simli
   * have no bones to gesture with). Mirrors every onStatusChange transition
   * this session fires, so a gesture animator can react to conversation
   * phase without this package depending on packages/avatar-core.
   */
  setPhase?(phase: ConversationSessionStatus): void;
}

export type SessionStartConfig = Omit<SessionStartMessage, "type">;

export interface ConnectConversationSessionOptions {
  /** Full WS URL including the ?ticket=... query param minted via a prior authenticated REST call. */
  wsUrl: string;
  micTrack: MediaStreamTrack;
  avatar: ConversationAvatarSink;
  sessionConfig: SessionStartConfig;
  onStatusChange: (status: ConversationSessionStatus) => void;
  onTranscript?: (entry: ConversationTranscriptEntry) => void;
  onLatency?: (event: ConversationLatencyEvent) => void;
  onCheckpointStarted?: (event: ConversationCheckpointStartedEvent) => void;
  onCheckpointResult?: (event: ConversationCheckpointResultEvent) => void;
  onModuleCompleted?: (event: ConversationModuleCompletedEvent) => void;
  onError?: (message: string) => void;
  /** Injectable for tests; defaults to `new WebSocket(url)`. */
  createWebSocket?: (url: string) => WebSocket;
  /** Injectable for tests; defaults to the browser's MediaRecorder. */
  createMediaRecorder?: (stream: MediaStream) => MediaRecorder;
  /**
   * Injectable for tests; defaults to a real AudioContext. One instance for
   * the whole session (VAD + every turn's audio decode) — a fresh, unclosed
   * AudioContext per turn is a real leak (Safari hard-caps live contexts).
   */
  createAudioContext?: () => AudioContext;
  /** Injectable for tests; defaults to web-speech-fallback.ts's recognizeOnce. */
  recognizeOnce?: () => Promise<{ text: string }>;
  /** Threaded through to voice-activity-detector.ts; injectable for tests, defaults to the browser's requestAnimationFrame. */
  requestAnimationFrame?: (callback: () => void) => number;
}

export interface ConversationSessionHandle {
  disconnect(): void;
}

const WS_OPEN = 1;

// Whisper-family STT models hallucinate plausible-sounding text on
// near-silent audio rather than reporting "no speech" — voice-activity-
// detector.ts's live per-frame threshold (0.02) can be satisfied by a brief
// noise spike (mic pop, background hum) even though the clip's overall
// energy never actually reached speech level, and that clip would otherwise
// still be sent for transcription. This is a stricter, whole-clip check
// applied after recording stops, not a replacement for the live VAD
// threshold. Same "reasoned starting point, not benchmarked" status as
// voice-activity-detector.ts's own thresholds — tune with real audio via
// `pnpm bench:latency` once there's a corpus of false-positive/negative
// recordings to tune against.
const MIN_UTTERANCE_RMS = 0.015;

/**
 * Orchestrates the WebSocket-based conversation loop per
 * .claude/specs/ai-avatar.md: VAD drives per-utterance recording, each
 * utterance's audio (or, once server STT is reported unavailable, a Web
 * Speech-recognized text fallback) is sent over the WS connection, and the
 * server's streamed per-sentence tts.chunk messages are played back through
 * the avatar sink strictly in order. Message history lives server-side for
 * the life of the connection — unlike the old REST-turn-based
 * voice-avatar-session.ts, the client does not resend growing history.
 */
export async function connectConversationSession(
  options: ConnectConversationSessionOptions,
): Promise<ConversationSessionHandle> {
  setStatus("connecting");

  const audioContext = options.createAudioContext?.() ?? new AudioContext();
  const micStream = new MediaStream([options.micTrack]);
  const recognize = options.recognizeOnce ?? defaultRecognizeOnce;

  let ended = false;
  // Assigned synchronously inside the connection Promise executor below,
  // before this function's `await` resolves and control returns to any
  // code that could call send()/disconnect() — TS can't see across that
  // closure boundary on its own, hence the definite-assignment assertion.
  let ws!: WebSocket;
  let currentUtteranceId: string | null = null;
  let sttDegraded = false;
  let playbackChain: Promise<void> = Promise.resolve();
  // True once the tts.chunk carrying isLastForUtterance for currentUtteranceId
  // has been queued (not necessarily finished playing yet). Lets turn.ended —
  // which the server sends as soon as IT is done streaming, well before the
  // client finishes playing a multi-sentence reply — tell whether anything is
  // still queued for this turn. See queuePlayback and the turn.ended handler.
  let finalChunkQueued = false;

  let currentRecorder: MediaRecorder | null = null;
  let recordedChunks: Blob[] = [];

  function send(message: ClientMessage): void {
    if (!ws || ws.readyState !== WS_OPEN) return;
    ws.send(JSON.stringify(clientMessageSchema.parse(message)));
  }

  // Single fan-out point for every phase transition this session fires —
  // keeps options.onStatusChange (UI state) and options.avatar.setPhase?
  // (gesture animator input) from drifting out of sync as new transitions
  // are added, instead of two-lining every one of the 13 call sites below.
  function setStatus(status: ConversationSessionStatus): void {
    options.onStatusChange(status);
    options.avatar.setPhase?.(status);
  }

  const barge = createBargeInController({
    stopPlayback: () => {
      options.avatar.interrupt();
      playbackChain = Promise.resolve();
      // Any chain links already scheduled against the old playbackChain
      // still run later (reassigning the variable doesn't cancel them) —
      // nulling here is what makes their staleness check in queuePlayback
      // actually skip them, and what lets a barge-in during the trailing
      // sentences of a reply (not just mid-generation) work at all.
      currentUtteranceId = null;
      finalChunkQueued = false;
    },
    notifyServer: (utteranceId) => send({ type: "barge_in", utteranceId }),
    getCurrentUtteranceId: () => currentUtteranceId,
  });

  function startRecording(): void {
    if (ended || currentRecorder) return;
    barge.handleSpeechStart();
    recordedChunks = [];
    const recorder = options.createMediaRecorder?.(micStream) ?? new MediaRecorder(micStream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };
    recorder.start();
    currentRecorder = recorder;
    setStatus("listening");
  }

  async function stopRecordingAndSend(): Promise<void> {
    const recorder = currentRecorder;
    if (!recorder || ended) return;
    currentRecorder = null;
    setStatus("thinking");

    const utteranceId = crypto.randomUUID();

    try {
      if (sttDegraded) {
        recorder.stop();
        const result = await recognize();
        if (!ended && result.text) {
          send({ type: "text.fallback", utteranceId, text: result.text });
        }
        return;
      }

      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.stop();
      await stopped;
      if (recordedChunks.length === 0) return;

      const blob = new Blob(recordedChunks, { type: recorder.mimeType || "audio/webm" });
      const wav = await encodeBlobAsWav({ blob, createAudioContext: () => audioContext });

      if (wav.rms < MIN_UTTERANCE_RMS) {
        // Never reached real speech energy overall — most likely a noise
        // spike that satisfied the live VAD threshold momentarily. Drop the
        // turn silently rather than risk a hallucinated Whisper transcript;
        // there is nothing to tell the user, since nothing was said.
        if (!ended) setStatus("listening");
        return;
      }

      const audioBase64 = await blobToBase64(new Blob([wav.bytes], { type: wav.mimeType }));

      if (!ended) send({ type: "audio.chunk", utteranceId, audioBase64, mimeType: wav.mimeType });
    } catch {
      if (!ended) setStatus("error");
    }
  }

  const vad = startVoiceActivityDetector({
    micTrack: options.micTrack,
    onSpeechStart: startRecording,
    onSpeechEnd: () => {
      void stopRecordingAndSend();
    },
    createAudioContext: () => audioContext,
    requestAnimationFrame: options.requestAnimationFrame,
  });

  function queuePlayback(chunk: Extract<ServerMessage, { type: "tts.chunk" }>): void {
    if (chunk.isLastForUtterance) finalChunkQueued = true;

    // Decode starts now, in arrival order, NOT gated behind the previous
    // sentence's playback finishing — sentence audio for a whole turn
    // typically arrives in one fast WS burst well ahead of playback, so by
    // the time the chain reaches this chunk its track is normally already
    // decoded, and avatar.speak() for consecutive sentences can fire back to
    // back with no decode-latency gap between them. Ordering and staleness
    // are still enforced below, only by the chain and the utteranceId check,
    // never by decode timing. Errors surface where decodedPromise is
    // actually awaited below; this bare .catch only stops a same-tick
    // rejection (bad audio bytes) from logging as an unhandled rejection
    // before that await runs.
    const decodedPromise = createAudioTrackFromBytes({
      audioBytes: base64ToArrayBuffer(chunk.audioBase64),
      createAudioContext: () => audioContext,
    });
    decodedPromise.catch(() => {});

    playbackChain = playbackChain.then(async () => {
      // Dropped if a barge-in reset the chain, or a later turn has already
      // started, since this chunk belongs to a now-stale utterance.
      if (ended || currentUtteranceId !== chunk.utteranceId) return;
      try {
        const decoded = await decodedPromise;
        if (ended || currentUtteranceId !== chunk.utteranceId) return;
        options.avatar.speak(decoded.track, chunk.text);
        decoded.play();
        await decoded.onEnded;
      } catch (err) {
        // playbackChain is one long-lived promise for the WHOLE session
        // (only a barge-in ever resets it — see stopPlayback above), not
        // reset per turn. Without this catch, a single sentence's playback
        // failure (bad audio bytes, an avatar SDK error, a stalled
        // onEnded, etc.) rejects this link, and every sentence chained
        // after it — for the rest of the session, not just this turn —
        // would silently never play, since a rejected promise's `.then()`
        // chain skips every subsequent fulfillment handler. The transcript
        // ("transcript" case in handleServerMessage below) is a separate
        // code path that doesn't depend on playback succeeding, so the full
        // reply text kept showing up even though the avatar audibly stopped
        // partway through — reproduced live: a multi-sentence reply spoke
        // only its first sentence while the transcript showed the whole
        // thing. Logging and moving on keeps every later sentence — this
        // one and all future turns' — playing normally. Deferred via
        // queueMicrotask rather than called inline — realtime.md's playback-
        // chain rule bars new code inline in this callback outright, with no
        // carve-out for the (rare, error-only) branch; deferring the log
        // call itself, not just accepting the exception, keeps this literally
        // outside the callback's own synchronous execution.
        queueMicrotask(() =>
          console.error("[conversation-session] sentence playback failed, continuing with next sentence:", err),
        );
      } finally {
        // The last sentence of this turn has now had its turn in the chain
        // (played, skipped as stale, or errored — any of those still means
        // there is nothing left to wait for). turn.ended may already have
        // arrived by now (it always does, in practice — see the comment on
        // finalChunkQueued) and deliberately left this turn "open" rather
        // than nulling currentUtteranceId itself, specifically so this was
        // the moment that closes it out.
        if (chunk.isLastForUtterance && currentUtteranceId === chunk.utteranceId) {
          currentUtteranceId = null;
          finalChunkQueued = false;
          if (!ended) setStatus("listening");
        }
      }
    });
  }

  function handleServerMessage(event: MessageEvent): void {
    let parsed: ServerMessage;
    try {
      parsed = serverMessageSchema.parse(JSON.parse(String(event.data)));
    } catch {
      return; // malformed frame — ignore rather than crash the session
    }

    switch (parsed.type) {
      case "session.ready":
        // The UI's "LIVE" state should reflect the session being ready to
        // listen, not wait for the user's first detected utterance.
        if (!ended) setStatus("listening");
        break;
      case "transcript":
        options.onTranscript?.({
          utteranceId: parsed.utteranceId,
          role: parsed.role,
          text: parsed.text,
          final: parsed.final,
        });
        if (parsed.role === "avatar" && parsed.emotion) {
          options.avatar.setEmotion?.(parsed.emotion);
        }
        break;
      case "turn.started":
        currentUtteranceId = parsed.utteranceId;
        finalChunkQueued = false;
        setStatus("speaking");
        break;
      case "tts.chunk":
        queuePlayback(parsed);
        break;
      case "turn.ended":
        // The server sends this as soon as IT has finished streaming every
        // sentence — well before the client finishes playing them, since
        // playback takes real wall-clock time per sentence while sending is
        // just network round-trips. If a chunk carrying isLastForUtterance
        // has already been queued, queuePlayback's finally block owns
        // closing out this turn once that sentence actually finishes
        // playing; nulling currentUtteranceId here instead would make
        // still-queued sentences look "stale" to queuePlayback's staleness
        // check and silently drop them — the avatar would stop partway
        // through a multi-sentence reply. Only close out here for the one
        // case nothing else will: a turn with no sentences at all (e.g. an
        // empty LLM reply), where no tts.chunk ever arrives to do it.
        if (!finalChunkQueued) {
          currentUtteranceId = null;
          if (!ended) setStatus("listening");
        }
        break;
      case "turn.cancelled":
        currentUtteranceId = null;
        finalChunkQueued = false;
        break;
      case "stt.failed":
        // Once server-side STT reports unavailable, stay on the client-side
        // Web Speech fallback for the rest of the session rather than
        // re-attempting per utterance — simplest correct behavior;
        // `retryable` is forwarded for future refinement, not branched on.
        sttDegraded = true;
        if (!ended) setStatus("listening");
        break;
      case "turn.failed":
        currentUtteranceId = null;
        options.onError?.(parsed.message);
        if (!ended) setStatus("listening");
        break;
      case "latency":
        options.onLatency?.({
          utteranceId: parsed.utteranceId,
          sttMs: parsed.sttMs,
          llmFirstTokenMs: parsed.llmFirstTokenMs,
          ttsFirstChunkMs: parsed.ttsFirstChunkMs,
          totalMs: parsed.totalMs,
          servedBy: parsed.servedBy,
        });
        break;
      case "error":
        options.onError?.(parsed.message ?? parsed.code);
        break;
      case "checkpoint.started":
        options.onCheckpointStarted?.({ objectiveId: parsed.objectiveId, objectiveTitle: parsed.objectiveTitle });
        break;
      case "checkpoint.result":
        options.onCheckpointResult?.({
          objectiveId: parsed.objectiveId,
          verdict: parsed.verdict,
          feedback: parsed.feedback,
          attempts: parsed.attempts,
        });
        break;
      case "module.completed":
        options.onModuleCompleted?.({ curriculumId: parsed.curriculumId });
        break;
    }
  }

  await new Promise<void>((resolve, reject) => {
    ws = options.createWebSocket?.(options.wsUrl) ?? new WebSocket(options.wsUrl);

    ws.addEventListener("open", () => {
      send({ type: "session.start", ...options.sessionConfig });
      resolve();
    });
    ws.addEventListener("error", () => reject(new Error("ws_connect_failed")));
    ws.addEventListener("message", handleServerMessage);
    ws.addEventListener("close", () => {
      if (!ended) setStatus("error");
    });
  });

  return {
    disconnect(): void {
      ended = true;
      vad.stop();
      currentRecorder?.stop();
      send({ type: "session.end" });
      ws.close();
      audioContext.close().catch(() => {});
      setStatus("ended");
    },
  };
}
