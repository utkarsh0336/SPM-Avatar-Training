import { describe, expect, it, vi } from "vitest";

vi.mock("./tts-echogarden.js", () => ({
  createEchogardenTTSProvider: () => ({
    name: "echogarden",
    mimeType: "audio/wav",
    async *synthesize() {
      yield new Uint8Array([1]);
    },
  }),
}));

vi.mock("./tts-msedge.js", () => ({
  createMsEdgeTTSProvider: () => ({
    name: "msedge-tts",
    mimeType: "audio/webm;codecs=opus",
    async *synthesize() {
      yield new Uint8Array([2]);
    },
  }),
}));

const { createTTSProviderFromEnv } = await import("./tts-factory.js");

const opts = { signal: new AbortController().signal };

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of iterable) void _;
}

describe("createTTSProviderFromEnv", () => {
  it("defaults to echogarden first when TTS_PROVIDER is unset (English, the default language)", async () => {
    const onResolved = vi.fn();
    const provider = createTTSProviderFromEnv("NEUTRAL", "FEMALE", "English", {}, { onResolved });
    await drain(provider.synthesize("hi", "unused", opts));
    expect(onResolved).toHaveBeenCalledWith("echogarden", "audio/wav");
  });

  it("tries msedge-tts first when TTS_PROVIDER=msedge-tts", async () => {
    const onResolved = vi.fn();
    const provider = createTTSProviderFromEnv(
      "WARM",
      "MALE",
      "English",
      { TTS_PROVIDER: "msedge-tts" },
      { onResolved },
    );
    await drain(provider.synthesize("hi", "unused", opts));
    expect(onResolved).toHaveBeenCalledWith("msedge-tts", "audio/webm;codecs=opus");
  });

  it("routes Hindi to msedge-tts only, even with TTS_PROVIDER unset (echogarden has no Hindi voices)", async () => {
    const onResolved = vi.fn();
    const provider = createTTSProviderFromEnv("NEUTRAL", "FEMALE", "Hindi", {}, { onResolved });
    await drain(provider.synthesize("नमस्ते", "unused", opts));
    expect(onResolved).toHaveBeenCalledWith("msedge-tts", "audio/webm;codecs=opus");
  });
});
