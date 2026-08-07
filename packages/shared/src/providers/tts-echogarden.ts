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
export function createEchogardenTTSProvider(options?: EchogardenTTSOptions): TTSProvider {
  const synthesizeImpl = options?.synthesizeImpl ?? synthesize;

  return {
    name: "echogarden",
    mimeType: "audio/wav",
    async *synthesize(text: string, voice: string, opts: TTSSynthesizeOptions): AsyncIterable<Uint8Array> {
      if (opts.signal.aborted) return;

      let result: Awaited<ReturnType<typeof synthesize>>;
      try {
        result = await synthesizeImpl(text, {
          engine: "vits",
          voice,
          outputAudioFormat: { codec: "wav" },
        });
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
  await synthesize("Warming up.", { engine: "vits", voice, outputAudioFormat: { codec: "wav" } });
}
