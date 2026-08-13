import { describe, expect, it, vi } from "vitest";
import { createEchogardenTTSProvider } from "./tts-echogarden.js";

async function collect(iterable: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

describe("createEchogardenTTSProvider", () => {
  it("calls synthesize with the vits engine, given voice, and wav output format", async () => {
    let capturedArgs: unknown[] = [];
    const synthesizeImpl = (async (...args: unknown[]) => {
      capturedArgs = args;
      return { audio: new Uint8Array([1, 2, 3]), timeline: [], language: "en" };
    }) as never;
    const provider = createEchogardenTTSProvider({ synthesizeImpl });

    const chunks = await collect(
      provider.synthesize("hello", "en_US-libritts_r-medium", { signal: new AbortController().signal }),
    );

    expect(chunks).toEqual([new Uint8Array([1, 2, 3])]);
    expect(capturedArgs[0]).toBe("hello");
    expect(capturedArgs[1]).toMatchObject({
      engine: "vits",
      voice: "en_US-libritts_r-medium",
      outputAudioFormat: { codec: "wav" },
    });
    expect(provider.mimeType).toBe("audio/wav");
  });

  it("throws a ProviderError if the result isn't encoded WAV bytes", async () => {
    const synthesizeImpl = (async () => ({
      audio: { sampleRate: 22050, channels: [] },
      timeline: [],
      language: "en",
    })) as never;
    const provider = createEchogardenTTSProvider({ synthesizeImpl });

    await expect(
      collect(provider.synthesize("hello", "v", { signal: new AbortController().signal })),
    ).rejects.toMatchObject({ provider: "echogarden" });
  });

  it("throws a ProviderError when synthesis fails", async () => {
    const synthesizeImpl = (async () => {
      throw new Error("model download failed");
    }) as never;
    const provider = createEchogardenTTSProvider({ synthesizeImpl });

    await expect(
      collect(provider.synthesize("hello", "v", { signal: new AbortController().signal })),
    ).rejects.toMatchObject({ provider: "echogarden", message: expect.stringContaining("model download failed") });
  });

  it("yields nothing when already aborted before synthesis starts", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const synthesizeImpl = (async () => {
      called = true;
      return { audio: new Uint8Array([1]), timeline: [], language: "en" };
    }) as never;
    const provider = createEchogardenTTSProvider({ synthesizeImpl });

    const chunks = await collect(provider.synthesize("hello", "v", { signal: controller.signal }));
    expect(chunks).toEqual([]);
    expect(called).toBe(false);
  });

  it("serializes concurrent calls into synthesizeImpl across separate provider instances — onnxruntime-node's native session creation segfaults if two overlap, and conversation-service.ts constructs a fresh provider per sentence", async () => {
    let activeCalls = 0;
    let maxConcurrentCalls = 0;
    const synthesizeImpl = (async () => {
      activeCalls += 1;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeCalls -= 1;
      return { audio: new Uint8Array([1]), timeline: [], language: "en" };
    }) as never;

    const providerA = createEchogardenTTSProvider({ synthesizeImpl });
    const providerB = createEchogardenTTSProvider({ synthesizeImpl });
    const providerC = createEchogardenTTSProvider({ synthesizeImpl });

    await Promise.all([
      collect(providerA.synthesize("a", "v", { signal: new AbortController().signal })),
      collect(providerB.synthesize("b", "v", { signal: new AbortController().signal })),
      collect(providerC.synthesize("c", "v", { signal: new AbortController().signal })),
    ]);

    expect(maxConcurrentCalls).toBe(1);
  });

  it("keeps serializing later calls after an earlier queued call throws", async () => {
    const synthesizeImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("first call fails"))
      .mockResolvedValueOnce({ audio: new Uint8Array([9]), timeline: [], language: "en" }) as never;

    const providerA = createEchogardenTTSProvider({ synthesizeImpl });
    const providerB = createEchogardenTTSProvider({ synthesizeImpl });

    const [resultA, resultB] = await Promise.allSettled([
      collect(providerA.synthesize("a", "v", { signal: new AbortController().signal })),
      collect(providerB.synthesize("b", "v", { signal: new AbortController().signal })),
    ]);

    expect(resultA.status).toBe("rejected");
    expect(resultB.status).toBe("fulfilled");
    expect(resultB.status === "fulfilled" && resultB.value).toEqual([new Uint8Array([9])]);
  });
});
