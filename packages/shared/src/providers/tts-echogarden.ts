import { synthesize } from "echogarden";
import type { TTSProvider, TTSSynthesizeOptions } from "./types.js";
import { ProviderError } from "./provider-error.js";

export interface EchogardenTTSOptions {
  /** Injectable for tests; defaults to echogarden's real synthesize(). */
  synthesizeImpl?: typeof synthesize;
}

/**
 * Verified live (not guessed): echogarden has no literal "piper" engine —
 * Piper's .onnx voice models are served through echogarden's "vits" engine
 * (its own CLI docs show `engine: "vits", voice: "amy"`). Confirmed by
 * actually running `synthesize("...", { engine: "vits", voice:
 * "en_US-libritts_r-medium" })`: the voice resolves correctly, and with
 * `outputAudioFormat: { codec: "wav" }` the result's `audio` field is a
 * plain Uint8Array of WAV bytes (not a RawAudio {sampleRate, channels}
 * object) — this adapter relies on that.
 *
 * Also confirmed live: the voice model + its espeak-ng phonemizer dependency
 * (~85MB total) auto-download from echogarden's CDN on first use, cached to
 * the OS app-data dir (e.g. ~/Library/Application Support/echogarden on
 * macOS) — no manual `echogarden install` step needed. First-ever call in a
 * fresh process took ~30s (download) / ~650ms (cached on disk, fresh
 * process); once warm in-process, synthesis is ~50-80ms. See warmUp() below
 * — apps/api calls it once at boot so a live user turn never pays this.
 */
// onnxruntime-node's native InferenceSession creation is not safe to call
// concurrently — echogarden's "vits" engine loads a fresh native ONNX
// session on every synthesize() call (no session reuse/caching across
// calls), and two overlapping loads reliably segfault the whole process
// (confirmed live via a macOS crash report: SIGSEGV in
// InferenceSessionWrap::LoadModel). This is a real risk, not a theoretical
// one: conversation-service.ts's enqueueSentence() deliberately fires TTS
// synthesis for every sentence concurrently (a latency optimization, not a
// bug) as each sentence boundary streams in from the LLM, and constructs a
// FRESH provider per sentence — so the lock has to be process-wide (module
// scope), not per-provider-instance, or sibling sentences' providers
// wouldn't share it. Only the native call itself is serialized; sentence
// chunking, LLM streaming, and the msedge-tts failover candidate are
// unaffected and stay fully concurrent.
let synthesisQueue: Promise<void> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = synthesisQueue.then(fn, fn);
  synthesisQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function createEchogardenTTSProvider(options?: EchogardenTTSOptions): TTSProvider {
  const synthesizeImpl = options?.synthesizeImpl ?? synthesize;

  return {
    name: "echogarden",
    mimeType: "audio/wav",
    async *synthesize(text: string, voice: string, opts: TTSSynthesizeOptions): AsyncIterable<Uint8Array> {
      if (opts.signal.aborted) return;

      let result: Awaited<ReturnType<typeof synthesize>>;
      try {
        result = await runSerialized(() =>
          synthesizeImpl(text, {
            engine: "vits",
            voice,
            voiceGender: opts.voiceGender,
            outputAudioFormat: { codec: "wav" },
          }),
        );
      } catch (error) {
        throw new ProviderError(
          "other",
          "echogarden",
          error instanceof Error ? error.message : "echogarden synthesis failed",
        );
      }

      // CPU-bound native ONNX inference isn't preemptible mid-call — this is
      // the earliest point cancellation can take effect. See the plan's
      // barge-in risk note: the ~300ms budget is a client-side-only
      // guarantee for this provider, not something the server can enforce.
      if (opts.signal.aborted) return;

      if (!(result.audio instanceof Uint8Array)) {
        throw new ProviderError(
          "other",
          "echogarden",
          "expected encoded WAV bytes (outputAudioFormat.codec was set) but got a RawAudio object",
        );
      }
      yield result.audio;
    },
  };
}

/**
 * Fire once at server boot (not on a live user turn) so the ~30s
 * first-download or ~650ms first-load cost never lands on end-of-speech
 * latency. Best-effort — a failure here just means the first real turn pays
 * the cost instead; it does not fail server startup.
 */
export async function warmUpEchogarden(voice: string): Promise<void> {
  await runSerialized(() =>
    synthesize("Warming up.", { engine: "vits", voice, outputAudioFormat: { codec: "wav" } }),
  );
}
