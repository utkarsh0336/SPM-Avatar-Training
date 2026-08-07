import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const setMetadata = vi.fn();
const toStream = vi.fn();

vi.mock("msedge-tts", () => ({
  OUTPUT_FORMAT: { WEBM_24KHZ_16BIT_MONO_OPUS: "webm-24khz-16bit-mono-opus" },
  MsEdgeTTS: vi.fn().mockImplementation(() => ({ setMetadata, toStream })),
}));

const { createMsEdgeTTSProvider } = await import("./tts-msedge.js");

async function collect(iterable: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

describe("createMsEdgeTTSProvider", () => {
  it("sets voice metadata and streams the resulting audio chunks", async () => {
    toStream.mockResolvedValue({ audioStream: Readable.from([Buffer.from([1, 2]), Buffer.from([3, 4])]) });
    const provider = createMsEdgeTTSProvider();

    const chunks = await collect(
      provider.synthesize("hello", "en-US-AriaNeural", { signal: new AbortController().signal }),
    );

    expect(setMetadata).toHaveBeenCalledWith("en-US-AriaNeural", "webm-24khz-16bit-mono-opus");
    expect(chunks).toHaveLength(2);
    expect(provider.mimeType).toBe("audio/webm;codecs=opus");
  });

  it("throws a ProviderError when the upstream call fails", async () => {
    setMetadata.mockRejectedValueOnce(new Error("edge auth broke"));
    const provider = createMsEdgeTTSProvider();

    await expect(
      collect(provider.synthesize("hello", "en-US-AriaNeural", { signal: new AbortController().signal })),
    ).rejects.toMatchObject({ provider: "msedge-tts" });
  });

  it("stops yielding once the signal is aborted", async () => {
    // Readable.from() prefetches ahead of the consumer, so aborting
    // synchronously between two yields in the source (as a naive test would)
    // races Node's internal stream buffering rather than testing the
    // provider's own abort check. Instead: pull exactly one chunk through
    // the provider, abort for real, then prove the next pull stops.
    const controller = new AbortController();
    let releaseSecondChunk!: () => void;
    const secondChunkReady = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });
    const stream = Readable.from(
      (async function* () {
        yield Buffer.from([1]);
        await secondChunkReady;
        yield Buffer.from([2]);
      })(),
    );
    toStream.mockResolvedValue({ audioStream: stream });
    const provider = createMsEdgeTTSProvider();

    const iterator = provider.synthesize("hello", "en-US-AriaNeural", { signal: controller.signal })[
      Symbol.asyncIterator
    ]();

    const first = await iterator.next();
    expect(first.done).toBe(false);

    controller.abort();
    releaseSecondChunk();
    const second = await iterator.next();
    expect(second.done).toBe(true);
  });
});
