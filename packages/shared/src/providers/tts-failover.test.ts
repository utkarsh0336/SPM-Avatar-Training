import { describe, expect, it, vi } from "vitest";
import { AllTTSProvidersFailedError, createFailoverTTSProvider, type TTSProviderCandidate } from "./tts-failover.js";
import type { TTSProvider } from "./types.js";
import { ProviderError } from "./provider-error.js";

function fakeProvider(mimeType: string, behavior: "throw" | (() => AsyncIterable<Uint8Array>)): TTSProvider {
  return {
    name: "fake",
    mimeType,
    async *synthesize() {
      if (behavior === "throw") throw new ProviderError("server_error", "fake", "down");
      for await (const chunk of behavior()) yield chunk;
    },
  };
}

async function* justYield(...values: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield value;
}

const opts = { signal: new AbortController().signal };

describe("createFailoverTTSProvider", () => {
  it("serves from the first candidate and reports its mimeType via onResolved", async () => {
    const onResolved = vi.fn();
    const candidates: TTSProviderCandidate[] = [
      { name: "primary", voice: "v1", provider: fakeProvider("audio/wav", () => justYield(new Uint8Array([1]))) },
      { name: "fallback", voice: "v2", provider: fakeProvider("audio/webm;codecs=opus", "throw") },
    ];
    const failover = createFailoverTTSProvider(candidates, { onResolved });

    const out: Uint8Array[] = [];
    for await (const chunk of failover.synthesize("hi", "unused", opts)) out.push(chunk);

    expect(out).toHaveLength(1);
    expect(onResolved).toHaveBeenCalledWith("primary", "audio/wav");
  });

  it("falls through to the fallback candidate and reports ITS mimeType, not the primary's", async () => {
    const onResolved = vi.fn();
    const candidates: TTSProviderCandidate[] = [
      { name: "primary", voice: "v1", provider: fakeProvider("audio/wav", "throw") },
      {
        name: "fallback",
        voice: "v2",
        provider: fakeProvider("audio/webm;codecs=opus", () => justYield(new Uint8Array([9]))),
      },
    ];
    const failover = createFailoverTTSProvider(candidates, { onResolved });

    const out: Uint8Array[] = [];
    for await (const chunk of failover.synthesize("hi", "unused", opts)) out.push(chunk);

    expect(out).toEqual([new Uint8Array([9])]);
    expect(onResolved).toHaveBeenCalledWith("fallback", "audio/webm;codecs=opus");
  });

  it("throws AllTTSProvidersFailedError naming every attempted candidate when all fail", async () => {
    const candidates: TTSProviderCandidate[] = [
      { name: "primary", voice: "v1", provider: fakeProvider("audio/wav", "throw") },
      { name: "fallback", voice: "v2", provider: fakeProvider("audio/webm;codecs=opus", "throw") },
    ];
    const failover = createFailoverTTSProvider(candidates);

    async function drain() {
      const out: Uint8Array[] = [];
      for await (const chunk of failover.synthesize("hi", "unused", opts)) out.push(chunk);
      return out;
    }

    await expect(drain()).rejects.toThrow(AllTTSProvidersFailedError);
    await expect(drain()).rejects.toMatchObject({ attempted: ["primary", "fallback"] });
  });

  it("passes each candidate its own configured voice, not the caller's voice argument", async () => {
    const synthesizeSpy = vi.fn(async function* () {
      yield new Uint8Array([1]);
    });
    const candidates: TTSProviderCandidate[] = [
      { name: "primary", voice: "candidate-specific-voice", provider: { name: "p", mimeType: "audio/wav", synthesize: synthesizeSpy } },
    ];
    const failover = createFailoverTTSProvider(candidates);

    const out: Uint8Array[] = [];
    for await (const chunk of failover.synthesize("hi", "caller-voice-ignored", opts)) out.push(chunk);

    expect(synthesizeSpy).toHaveBeenCalledWith("hi", "candidate-specific-voice", opts);
  });
});
