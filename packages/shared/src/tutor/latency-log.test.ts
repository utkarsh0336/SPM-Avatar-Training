import { describe, expect, it, vi } from "vitest";
import { createTurnLatencyTracker } from "./latency-log.js";

describe("createTurnLatencyTracker", () => {
  it("records deltas relative to construction time, in order", () => {
    let t = 1000;
    const now = () => t;
    const tracker = createTurnLatencyTracker("turn-1", now);

    t = 1100;
    tracker.markSttDone();
    t = 1300;
    tracker.markLlmFirstToken();
    t = 1450;
    tracker.markTtsFirstChunk();
    t = 1500;
    const entry = tracker.finish({ llm: "gemini", stt: "groq-whisper", tts: "echogarden" });

    expect(entry).toEqual({
      turnId: "turn-1",
      sttMs: 100,
      llmFirstTokenMs: 300,
      ttsFirstChunkMs: 450,
      totalMs: 500,
      servedBy: { llm: "gemini", stt: "groq-whisper", tts: "echogarden" },
    });
  });

  it("leaves unmarked hops undefined rather than zero", () => {
    let t = 0;
    const tracker = createTurnLatencyTracker("turn-2", () => t);
    t = 50;
    const entry = tracker.finish();
    expect(entry.sttMs).toBeUndefined();
    expect(entry.llmFirstTokenMs).toBeUndefined();
    expect(entry.ttsFirstChunkMs).toBeUndefined();
    expect(entry.totalMs).toBe(50);
  });

  it("logs a structured turn_latency JSON line on finish", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = createTurnLatencyTracker("turn-3", () => 0);
    tracker.finish();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(logged.event).toBe("turn_latency");
    expect(logged.turnId).toBe("turn-3");
    logSpy.mockRestore();
  });
});
