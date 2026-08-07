import { describe, expect, it, vi } from "vitest";
import { AllLLMProvidersFailedError, createFailoverLLMProvider, type LLMProviderCandidate } from "./llm-failover.js";
import type { LLMProvider } from "./types.js";
import { ProviderError } from "./provider-error.js";

function fakeProvider(behavior: "throw-immediately" | "throw-mid-stream" | (() => AsyncIterable<string>)): LLMProvider {
  return {
    name: "fake",
    async *chat() {
      if (behavior === "throw-immediately") {
        throw new ProviderError("auth_error", "fake", "invalid key");
      }
      if (behavior === "throw-mid-stream") {
        yield "partial";
        throw new Error("connection dropped");
      }
      for await (const chunk of behavior()) yield chunk;
    },
  };
}

async function* justYield(...values: string[]): AsyncIterable<string> {
  for (const value of values) yield value;
}

const opts = { systemPrompt: "sys", signal: new AbortController().signal };

describe("createFailoverLLMProvider", () => {
  it("serves from the first candidate when it succeeds, without trying the rest", async () => {
    const onResolved = vi.fn();
    const second = fakeProvider("throw-immediately");
    const candidates: LLMProviderCandidate[] = [
      { name: "primary", provider: fakeProvider(() => justYield("hello")) },
      { name: "secondary", provider: second },
    ];
    const secondSpy = vi.spyOn(second, "chat");

    const failover = createFailoverLLMProvider(candidates, { onResolved });
    const out: string[] = [];
    for await (const chunk of failover.chat([], opts)) out.push(chunk);

    expect(out).toEqual(["hello"]);
    expect(onResolved).toHaveBeenCalledWith("primary");
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(secondSpy).not.toHaveBeenCalled();
  });

  it("falls through to the next candidate when the first throws on its first chunk", async () => {
    const onResolved = vi.fn();
    const candidates: LLMProviderCandidate[] = [
      { name: "primary", provider: fakeProvider("throw-immediately") },
      { name: "secondary", provider: fakeProvider(() => justYield("fallback reply")) },
    ];

    const failover = createFailoverLLMProvider(candidates, { onResolved });
    const out: string[] = [];
    for await (const chunk of failover.chat([], opts)) out.push(chunk);

    expect(out).toEqual(["fallback reply"]);
    expect(onResolved).toHaveBeenCalledWith("secondary");
  });

  it("throws AllLLMProvidersFailedError naming every attempted candidate when all fail", async () => {
    const candidates: LLMProviderCandidate[] = [
      { name: "primary", provider: fakeProvider("throw-immediately") },
      { name: "secondary", provider: fakeProvider("throw-immediately") },
    ];
    const failover = createFailoverLLMProvider(candidates);

    async function drain() {
      const out: string[] = [];
      for await (const chunk of failover.chat([], opts)) out.push(chunk);
      return out;
    }

    await expect(drain()).rejects.toThrow(AllLLMProvidersFailedError);
    await expect(drain()).rejects.toMatchObject({ attempted: ["primary", "secondary"] });
  });

  it("does not retry once a candidate has yielded its first chunk — mid-stream failure propagates", async () => {
    const candidates: LLMProviderCandidate[] = [
      { name: "primary", provider: fakeProvider("throw-mid-stream") },
      { name: "secondary", provider: fakeProvider(() => justYield("should not be used")) },
    ];
    const failover = createFailoverLLMProvider(candidates);

    async function drain() {
      const out: string[] = [];
      for await (const chunk of failover.chat([], opts)) out.push(chunk);
      return out;
    }

    await expect(drain()).rejects.toThrow("connection dropped");
  });
});
