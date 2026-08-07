import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { TTSProvider, TTSSynthesizeOptions } from "./types.js";
import { ProviderError } from "./provider-error.js";

// Verified: new MsEdgeTTS() -> setMetadata(voice, format) -> toStream(text)
// returns { audioStream }, a Node Readable (async-iterable Buffer chunks).
// Unofficial/reverse-engineered (msedge-tts README notes recurring
// Microsoft-side auth breakage) — used only as the TTS fallback, never
// primary. See the plan's TTS fallback risk note.
export function createMsEdgeTTSProvider(): TTSProvider {
  return {
    name: "msedge-tts",
    mimeType: "audio/webm;codecs=opus",
    async *synthesize(text: string, voice: string, opts: TTSSynthesizeOptions): AsyncIterable<Uint8Array> {
      const tts = new MsEdgeTTS();
      let audioStream: NodeJS.ReadableStream;
      try {
        await tts.setMetadata(voice, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
        ({ audioStream } = await tts.toStream(text));
      } catch (error) {
        throw new ProviderError(
          "other",
          "msedge-tts",
          error instanceof Error ? error.message : "msedge-tts request failed",
        );
      }

      const onAbort = () => {
        if ("destroy" in audioStream && typeof audioStream.destroy === "function") {
          audioStream.destroy();
        }
      };
      opts.signal.addEventListener("abort", onAbort);

      try {
        for await (const chunk of audioStream as AsyncIterable<Uint8Array>) {
          if (opts.signal.aborted) break;
          yield chunk;
        }
      } catch (error) {
        // destroy()ing a stream mid-iteration makes Node's async iterator
        // throw ERR_STREAM_PREMATURE_CLOSE instead of ending cleanly — that
        // is expected and fine when WE triggered the destroy via abort;
        // anything else is a real stream error and must propagate.
        if (!opts.signal.aborted) throw error;
      } finally {
        opts.signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
