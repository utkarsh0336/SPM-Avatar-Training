import {
  buildSystemPrompt,
  createLLMProviderFromEnv,
  createSTTProviderFromEnv,
  createTTSProviderFromEnv,
  SentenceChunker,
  type Gender,
  type Language,
  type LLMProvider,
  type STTProvider,
  type TTSProvider,
  type VoiceTone,
} from "@avatrain/shared";
import { computeInt16PcmRms, encodeInt16PcmAsWav } from "./audio-encoding.js";
import { createTurnBoundaryDetector } from "./turn-boundary.js";

/**
 * Reuses apps/api/src/services/conversation-service.ts's exact provider
 * factories and turn shape (STT once per utterance, streamed LLM chat
 * sentence-chunked into per-sentence TTS calls, one AbortController per
 * turn) — the audio in/out plumbing is what's actually new here (LiveKit
 * frames + a sink callback instead of a WebSocket), not the orchestration
 * logic itself.
 *
 * **Known v1 scope gap, flagged not silently worked around**: the LiveKit
 * room metadata apps/api/src/lib/livekit.ts sets only carries
 * `{ orgId, trainingSessionId }` — no `avatarId` — so this handler has no
 * way to resolve the session's actual persona/expertise/voice the way
 * conversation-service.ts does from a real Avatar record. `avatarName`/
 * `expertise`/`voiceTone`/`voiceGender`/`voiceLanguage` below are
 * options with generic defaults for this pass; threading avatarId through
 * the room metadata the same way is a fast-follow, not done here.
 */

// Same guard, same value, as conversation-session.ts's MIN_UTTERANCE_RMS —
// not exported from that file (browser-only module), so duplicated as a
// named constant here rather than imported across the client/server
// boundary; same reasoning already established for AvatarEmotion etc.
const MIN_UTTERANCE_RMS = 0.015;

export interface JobHandlerDeps {
  createLLM?: typeof createLLMProviderFromEnv;
  createSTT?: typeof createSTTProviderFromEnv;
  createTTS?: typeof createTTSProviderFromEnv;
}

export interface JobHandlerOptions {
  /** One call per synthesized sentence — B3d just sinks this; B3e wires it into the Simli bridge. */
  onSentenceAudio: (audio: Uint8Array, mimeType: string, sentenceText: string) => void;
  /** One call per finalized turn (user utterance or avatar reply) — the data-channel publish point. */
  onTranscript: (entry: { role: "user" | "avatar"; text: string }) => void;
  /**
   * Fired synchronously when a new speech segment starts while a turn is
   * still in-flight — the barge-in signal. Callers must flush their
   * avatar/relay's own playback queue here (e.g. AvatarRelay.skip(), which
   * clears Simli's buffer) — this callback firing is what makes the fixed
   * barge-in order (stop playback → flush queue → cancel → neutral mouth)
   * from .claude/rules/realtime.md apply to the LiveKit path too. Without
   * it, an interrupted turn's already-in-flight AbortController is aborted
   * here, but nothing ever tells the avatar relay to stop playing what it
   * already queued from that turn.
   */
  onBargeIn?: () => void;
  onError?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
  deps?: JobHandlerDeps;
  sttLanguage?: string;
  avatarName?: string;
  expertise?: Parameters<typeof buildSystemPrompt>[0]["expertise"];
  voiceTone?: VoiceTone;
  voiceGender?: Gender;
  voiceLanguage?: Language;
  /** Injectable for tests; defaults to Date.now — threaded into the turn-boundary detector. */
  now?: () => number;
}

export interface JobHandler {
  /**
   * Feed one incoming audio frame from the human participant's subscribed
   * mic track. Positional args, not a `{ samples, sampleRate }` object —
   * this is called at real-time audio-frame cadence (LiveKit frames arrive
   * roughly every 10-20ms per participant) from livekit-worker.ts's pump
   * loop, and a latency review flagged the per-call wrapper-object
   * allocation the object-parameter form required as avoidable GC pressure
   * on that hot path.
   */
  pushAudioFrame(samples: Int16Array, sampleRate: number): void;
  /** Aborts the in-flight turn, if any — barge-in. */
  bargeIn(): void;
  /** Aborts any in-flight turn and stops accepting further frames. */
  stop(): void;
}

function concatInt16(frames: Int16Array[]): Int16Array {
  const total = frames.reduce((sum, f) => sum + f.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame, offset);
    offset += frame.length;
  }
  return out;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function createJobHandler(options: JobHandlerOptions): JobHandler {
  const env = options.env ?? process.env;
  const createLLM = options.deps?.createLLM ?? createLLMProviderFromEnv;
  const createSTT = options.deps?.createSTT ?? createSTTProviderFromEnv;
  const createTTS = options.deps?.createTTS ?? createTTSProviderFromEnv;

  const systemPrompt = buildSystemPrompt({
    avatarName: options.avatarName ?? "Your AI Trainer",
    expertise: options.expertise ?? "PRODUCT_TRAINING",
    language: options.voiceLanguage ?? "English",
  });

  let stopped = false;
  let currentAbortController: AbortController | null = null;
  let sampleRate = 16000;
  let isRecording = false;
  let recordingFrames: Int16Array[] = [];

  const turnBoundary = createTurnBoundaryDetector({
    now: options.now,
    onSpeechStart: () => {
      // Barge-in: a prior turn's AbortController being silently overwritten
      // by the next processTurn() call (without ever aborting it) was a
      // real bug a latency review caught — the old turn's LLM/TTS work and
      // its already-queued avatar audio would otherwise keep running
      // alongside the new one. Aborting here, before accepting the new
      // recording, closes that gap; processTurn's own `finally` block
      // already handles clearing currentAbortController correctly once the
      // aborted turn actually unwinds, so no manual null-out is needed here.
      if (currentAbortController) {
        currentAbortController.abort();
        options.onBargeIn?.();
      }
      isRecording = true;
      recordingFrames = [];
    },
    onSpeechEnd: () => {
      isRecording = false;
      const samples = concatInt16(recordingFrames);
      recordingFrames = [];
      void processTurn(samples);
    },
  });

  async function synthesizeAndEmit(tts: TTSProvider, text: string, signal: AbortSignal): Promise<void> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of tts.synthesize(text, "", { signal, voiceGender: toVoiceGender(options.voiceGender) })) {
      chunks.push(chunk);
    }
    if (signal.aborted) return;
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    options.onSentenceAudio(combined, tts.mimeType, text);
  }

  async function processTurn(samples: Int16Array): Promise<void> {
    if (stopped || samples.length === 0) return;
    if (computeInt16PcmRms(samples) < MIN_UTTERANCE_RMS) return; // noise spike, not real speech — see conversation-session.ts's own guard

    const controller = new AbortController();
    currentAbortController = controller;

    try {
      const stt: STTProvider | null = createSTT(env);
      if (!stt) {
        options.onError?.("stt_unavailable");
        return;
      }
      const wav = encodeInt16PcmAsWav(samples, sampleRate);
      const userText = (await stt.transcribe(wav, "audio/wav", { language: options.sttLanguage })).trim();
      if (!userText || stopped || controller.signal.aborted) return;
      options.onTranscript({ role: "user", text: userText });

      const llm: LLMProvider = createLLM(env);
      const tts: TTSProvider = createTTS(
        options.voiceTone ?? "WARM",
        options.voiceGender ?? "FEMALE",
        options.voiceLanguage ?? "English",
        env,
      );
      const chunker = new SentenceChunker();
      let fullReply = "";

      for await (const event of llm.chat([{ role: "user", content: userText }], {
        systemPrompt,
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) break;
        if (event.type !== "text") continue;
        fullReply += event.text;
        for (const sentence of chunker.push(event.text)) {
          if (controller.signal.aborted) break;
          await synthesizeAndEmit(tts, sentence, controller.signal);
        }
      }

      if (!controller.signal.aborted) {
        const trailing = chunker.flush();
        if (trailing) await synthesizeAndEmit(tts, trailing, controller.signal);
      }

      if (!controller.signal.aborted && fullReply.trim()) {
        options.onTranscript({ role: "avatar", text: fullReply.trim() });
      }
    } catch (err) {
      if (!isAbortError(err) && !stopped) {
        options.onError?.(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentAbortController === controller) currentAbortController = null;
    }
  }

  return {
    pushAudioFrame(samples: Int16Array, frameSampleRate: number): void {
      if (stopped) return;
      sampleRate = frameSampleRate;
      const rms = computeInt16PcmRms(samples);
      turnBoundary.pushFrameRms(rms); // may synchronously flip isRecording via the callbacks above
      if (isRecording) recordingFrames.push(samples);
    },
    bargeIn(): void {
      currentAbortController?.abort();
    },
    stop(): void {
      stopped = true;
      currentAbortController?.abort();
    },
  };
}

function toVoiceGender(gender: Gender | undefined): "male" | "female" | undefined {
  if (gender === "MALE") return "male";
  if (gender === "FEMALE") return "female";
  return undefined;
}
