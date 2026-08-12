import { describe, expect, it, vi } from "vitest";
import { AllLLMProvidersFailedError, createFailoverLLMProvider, type LLMProviderCandidate } from "./llm-failover.js";
import type { LLMProvider, LLMStreamEvent } from "./types.js";
import { ProviderError } from "./provider-error.js";

function fakeProvider(behavior: "throw-immediately" | "throw-mid-stream" | (() => AsyncIterable<LLMStreamEvent>)): LLMProvider {
  return {
    name: "fake",
    async *chat() {
      if (behavior === "throw-immediately") {
        throw new ProviderError("auth_error", "fake", "invalid key");
      }
      if (behavior === "throw-mid-stream") {
        yield { type: "text", text: "partial" };
        throw new Error("connection dropped");
      }
      for await (const event of behavior()) yield event;
    },
  };
}

async function* justYieldText(...values: string[]): AsyncIterable<LLMStreamEvent> {
  for (const value of values) yield { type: "text", text: value };
}

const opts = { systemPrompt: "sys", signal: new AbortController().signal };

async function drainText(provider: LLMProvider): Promise<string[]> {
  const out: string[] = [];
  for await (const event of provider.chat([], opts)) {
    if (event.type === "text") out.push(event.text);
  }
  return out;
}

describe("createFailoverLLMProvider", () => {
  it("serves from the first candidate when it succeeds, without trying the rest", async () => {
    const onResolved = vi.fn();
    const second = fakeProvider("throw-immediately");
    const candidates: LLMProviderCandidate[] = [
      { name: "primary", provider: fakeProvider(() => justYieldText("hello")) },
      { name: "secondary", provider: second },
    ];
    const secondSpy = vi.spyOn(second, "chat");

    const failover = createFailoverLLMProvider(candidates, { onResolved });
    const out = await drainText(failover);

    expect(out).toEqual(["hello"]);
    expect(onResolved).toHaveBeenCalledWith("primary");
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(secondSpy).not.toHaveBeenCalled();
  });

  it("falls through to the next candidate when the first throws on its first chunk", async () => {
    const onResolved = vi.fn();
    const candidates: LLMProviderCandidate[] = [
      { name: "primary", provider: fakeProvider("throw-immediately") },
      { name: "secondary", provider: fakeProvider(() => justYieldText("fallback reply")) },
    ];

    const failover = createFailoverLLMProvider(candidates, { onResolved });
    const out = await drainText(failover);

    expect(out).toEqual(["fallback reply"]);
    expect(onResolved).toHaveBeenCalledWith("secondary");
  });

  it("throws AllLLMProvidersFailedError naming every attempted candidate when all fail", async () => {
    const candidates: LLMProviderCandidate[] = [
      { name: "primary", provider: fakeProvider("throw-immediately") },
      { name: "secondary", provider: fakeProvider("throw-immediately") },
    ];
    const failover = createFailoverLLMProvider(candidates);

    await expect(drainText(failover)).rejects.toThrow(AllLLMProvidersFailedError);
    await expect(drainText(failover)).rejects.toMatchObject({ attempted: ["primary", "secondary"] });
  });

  it("does not retry once a candidate has yielded its first chunk — mid-stream failure propagates", async () => {
    const candidates: LLMProviderCandidate[] = [
      { name: "primary", provider: fakeProvider("throw-mid-stream") },
      { name: "secondary", provider: fakeProvider(() => justYieldText("should not be used")) },
    ];
    const failover = createFailoverLLMProvider(candidates);

    await expect(drainText(failover)).rejects.toThrow("connection dropped");
  });

  it("forwards a tool_call event exactly like a text event", async () => {
    async function* yieldToolCall(): AsyncIterable<LLMStreamEvent> {
      yield { type: "tool_call", id: "call-1", name: "start_checkpoint", args: { objectiveId: "obj-1" } };
    }
    const candidates: LLMProviderCandidate[] = [{ name: "primary", provider: fakeProvider(yieldToolCall) }];
    const failover = createFailoverLLMProvider(candidates);

    const out: LLMStreamEvent[] = [];
    for await (const event of failover.chat([], opts)) out.push(event);

    expect(out).toEqual([{ type: "tool_call", id: "call-1", name: "start_checkpoint", args: { objectiveId: "obj-1" } }]);
  });
});
