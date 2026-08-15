import { describe, expect, it } from "vitest";
import { runNativeOnnxSerialized } from "./native-onnx-lock.js";
import { createEchogardenTTSProvider } from "./tts-echogarden.js";
import { createLocalEmbeddingProvider } from "./embedding-local.js";

async function collect(iterable: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

describe("runNativeOnnxSerialized", () => {
  it("never runs two callbacks concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    };

    await Promise.all([
      runNativeOnnxSerialized(task),
      runNativeOnnxSerialized(task),
      runNativeOnnxSerialized(task),
    ]);

    expect(maxActive).toBe(1);
  });
});

describe("cross-consumer serialization (the crash this lock exists to prevent)", () => {
  it("never overlaps echogarden TTS synthesis with a local embedding call", async () => {
    // Two independent onnxruntime-node native sessions (echogarden's VITS
    // model and @xenova/transformers' MiniLM model) — a live crash
    // reproduced from these two overlapping across turns, not just from
    // echogarden overlapping itself. See native-onnx-lock.ts's doc comment.
    let active = 0;
    let maxActive = 0;
    const enter = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    };

    const synthesizeImpl = (async () => {
      await enter();
      return { audio: new Uint8Array([1]), timeline: [], language: "en" };
    }) as never;
    const ttsProvider = createEchogardenTTSProvider({ synthesizeImpl });

    const loadExtractor = async () =>
      (async (texts: string[]) => {
        await enter();
        return { tolist: () => texts.map(() => [0]) };
      }) as never;
    const embeddingProvider = createLocalEmbeddingProvider({ loadExtractor });

    await Promise.all([
      collect(ttsProvider.synthesize("hello", "v", { signal: new AbortController().signal })),
      embeddingProvider.embed(["query text"]),
    ]);

    expect(maxActive).toBe(1);
  });
});
