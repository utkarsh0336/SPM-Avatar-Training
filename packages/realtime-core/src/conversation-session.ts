import {
  clientMessageSchema,
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
  type SessionStartMessage,
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
 * Minimal structural subset of packages/avatar-core's AvatarProvider —
 * declared locally rather than imported so this package stays decoupled
 * from a specific avatar implementation, matching the existing pattern
 * (the old voice-avatar-session.ts took raw video/audio elements rather
 * than importing avatar-core). Any real AvatarProvider satisfies this.
 */
export interface ConversationAvatarSink {
  speak(audioTrack: MediaStreamTrack, subtitleText: string): void;
  interrupt(): void;
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
  options.onStatusChange("connecting");

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

  let currentRecorder: MediaRecorder | null = null;
  let recordedChunks: Blob[] = [];

  function send(message: ClientMessage): void {
    if (!ws || ws.readyState !== WS_OPEN) return;
    ws.send(JSON.stringify(clientMessageSchema.parse(message)));
  }

  const barge = createBargeInController({
    stopPlayback: () => {
      options.avatar.interrupt();
      playbackChain = Promise.resolve();
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
    options.onStatusChange("listening");
  }

  async function stopRecordingAndSend(): Promise<void> {
    const recorder = currentRecorder;
    if (!recorder || ended) return;
    currentRecorder = null;
    options.onStatusChange("thinking");

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
      const audioBase64 = await blobToBase64(new Blob([wav.bytes], { type: wav.mimeType }));

      if (!ended) send({ type: "audio.chunk", utteranceId, audioBase64, mimeType: wav.mimeType });
    } catch {
      if (!ended) options.onStatusChange("error");
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
    playbackChain = playbackChain.then(async () => {
      // Dropped if a barge-in reset the chain, or a later turn has already
      // started, since this chunk belongs to a now-stale utterance.
      if (ended || currentUtteranceId !== chunk.utteranceId) return;
      const decoded = await createAudioTrackFromBytes({
        audioBytes: base64ToArrayBuffer(chunk.audioBase64),
        createAudioContext: () => audioContext,
      });
      if (ended || currentUtteranceId !== chunk.utteranceId) return;
      options.avatar.speak(decoded.track, chunk.text);
      decoded.play();
      await decoded.onEnded;
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
        if (!ended) options.onStatusChange("listening");
        break;
      case "transcript":
        options.onTranscript?.({
          utteranceId: parsed.utteranceId,
          role: parsed.role,
          text: parsed.text,
          final: parsed.final,
        });
        break;
      case "turn.started":
        currentUtteranceId = parsed.utteranceId;
        options.onStatusChange("speaking");
        break;
      case "tts.chunk":
        queuePlayback(parsed);
        break;
      case "turn.ended":
        currentUtteranceId = null;
        if (!ended) options.onStatusChange("listening");
        break;
      case "turn.cancelled":
        currentUtteranceId = null;
        break;
      case "stt.failed":
        // Once server-side STT reports unavailable, stay on the client-side
        // Web Speech fallback for the rest of the session rather than
        // re-attempting per utterance — simplest correct behavior;
        // `retryable` is forwarded for future refinement, not branched on.
        sttDegraded = true;
        if (!ended) options.onStatusChange("listening");
        break;
      case "turn.failed":
        currentUtteranceId = null;
        options.onError?.(parsed.message);
        if (!ended) options.onStatusChange("listening");
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
      if (!ended) options.onStatusChange("error");
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
      options.onStatusChange("ended");
    },
  };
}
