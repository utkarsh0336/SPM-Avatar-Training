import { describe, expect, it, vi } from "vitest";
import type { LLMProvider, LLMStreamEvent, STTProvider, TTSProvider } from "@avatrain/shared";
import { createJobHandler } from "./job-handler.js";

const SAMPLE_RATE = 16000;

type FrameArgs = [samples: Int16Array, sampleRate: number];

function silentFrame(samples = 160): FrameArgs {
  return [new Int16Array(samples), SAMPLE_RATE];
}

function speechFrame(samples = 160, amplitude = 3000): FrameArgs {
  return [new Int16Array(samples).fill(amplitude), SAMPLE_RATE];
}

function createFakeClock(startMs = 0) {
  let current = startMs;
  return { now: () => current, advance: (ms: number) => (current += ms) };
}

function createFakeLLM(events: LLMStreamEvent[]): LLMProvider & { chatCalls: unknown[][] } {
  const chatCalls: unknown[][] = [];
  return {
    name: "fake-llm",
    chatCalls,
    async *chat(messages, opts) {
      chatCalls.push([messages, opts]);
      for (const event of events) {
        if (opts.signal.aborted) return;
        yield event;
      }
    },
  };
}

function createFakeSTT(text: string): STTProvider & { transcribe: ReturnType<typeof vi.fn> } {
  return {
    name: "fake-stt",
    transcribe: vi.fn().mockResolvedValue(text),
  };
}

function createFakeTTS(): TTSProvider & { synthesizeCalls: string[] } {
  const synthesizeCalls: string[] = [];
  return {
    name: "fake-tts",
    mimeType: "audio/wav",
    synthesizeCalls,
    async *synthesize(text, _voice, opts) {
      synthesizeCalls.push(text);
      if (opts.signal.aborted) return;
      yield new TextEncoder().encode(`audio:${text}`);
    },
  };
}

/** Drives a full speech-then-silence cycle through the turn-boundary detector's default thresholds. */
function driveOneUtterance(
  pushAudioFrame: (samples: Int16Array, sampleRate: number) => void,
  clock: ReturnType<typeof createFakeClock>,
): void {
  pushAudioFrame(...speechFrame()); // speech starts at t
  clock.advance(400); // past minSpeechDurationMs (300)
  pushAudioFrame(...silentFrame()); // silence begins
  clock.advance(700); // past silenceDurationMs (700)
  pushAudioFrame(...silentFrame());
}

describe("createJobHandler", () => {
  it("runs a full turn: STT -> LLM -> per-sentence TTS -> transcript callbacks, in order", async () => {
    const clock = createFakeClock();
    const stt = createFakeSTT("What is the leave policy?");
    const llm = createFakeLLM([
      { type: "text", text: "Employees get 20 days. " },
      { type: "text", text: "Sick leave is separate." },
    ]);
    const tts = createFakeTTS();
    const onTranscript = vi.fn();
    const onSentenceAudio = vi.fn();

    const handler = createJobHandler({
      onTranscript,
      onSentenceAudio,
      now: clock.now,
      deps: { createSTT: () => stt, createLLM: () => llm, createTTS: () => tts },
    });

    driveOneUtterance(handler.pushAudioFrame, clock);
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledTimes(2));

    expect(stt.transcribe).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenNthCalledWith(1, { role: "user", text: "What is the leave policy?" });
    expect(onTranscript).toHaveBeenNthCalledWith(2, {
      role: "avatar",
      text: "Employees get 20 days. Sick leave is separate.",
    });
    expect(tts.synthesizeCalls).toEqual(["Employees get 20 days.", "Sick leave is separate."]);
    expect(onSentenceAudio).toHaveBeenCalledTimes(2);
    expect(onSentenceAudio).toHaveBeenNthCalledWith(
      1,
      new TextEncoder().encode("audio:Employees get 20 days."),
      "audio/wav",
      "Employees get 20 days.",
    );
  });

  it("never calls STT/LLM/TTS for a burst whose overall energy never reached speech level (noise spike)", async () => {
    const clock = createFakeClock();
    const stt = createFakeSTT("should never be reached");
    const llm = createFakeLLM([{ type: "text", text: "unused" }]);
    const tts = createFakeTTS();
    const onTranscript = vi.fn();

    const handler = createJobHandler({
      onTranscript,
      onSentenceAudio: vi.fn(),
      now: clock.now,
      deps: { createSTT: () => stt, createLLM: () => llm, createTTS: () => tts },
    });

    // Low-amplitude "speech" (RMS momentarily above the live 0.02 threshold
    // via a small burst) but silent otherwise — overall clip RMS stays
    // under MIN_UTTERANCE_RMS (0.015).
    handler.pushAudioFrame(...speechFrame(4, 700)); // brief loud blip: RMS ~0.021, just above the live per-frame threshold
    clock.advance(400);
    handler.pushAudioFrame(...silentFrame(4000)); // long silence — the OVERALL utterance's RMS is now tiny
    clock.advance(700);
    handler.pushAudioFrame(...silentFrame());

    await vi.waitFor(() => expect(stt.transcribe).not.toHaveBeenCalled());
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("emits onError(\"stt_unavailable\") and never calls LLM/TTS when STT isn't configured", async () => {
    const clock = createFakeClock();
    const llm = createFakeLLM([{ type: "text", text: "unused" }]);
    const tts = createFakeTTS();
    const onError = vi.fn();

    const handler = createJobHandler({
      onTranscript: vi.fn(),
      onSentenceAudio: vi.fn(),
      onError,
      now: clock.now,
      deps: { createSTT: () => null, createLLM: () => llm, createTTS: () => tts },
    });

    driveOneUtterance(handler.pushAudioFrame, clock);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("stt_unavailable"));
    expect(tts.synthesizeCalls).toEqual([]);
  });

  it("does not start a turn when STT returns an empty transcription", async () => {
    const clock = createFakeClock();
    const stt = createFakeSTT("   "); // whitespace-only
    const llm = createFakeLLM([{ type: "text", text: "unused" }]);
    const onTranscript = vi.fn();

    const handler = createJobHandler({
      onTranscript,
      onSentenceAudio: vi.fn(),
      now: clock.now,
      deps: { createSTT: () => stt, createLLM: () => llm, createTTS: () => createFakeTTS() },
    });

    driveOneUtterance(handler.pushAudioFrame, clock);
    await vi.waitFor(() => expect(stt.transcribe).toHaveBeenCalled());
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("bargeIn() aborts the in-flight turn, stopping further sentence synthesis and suppressing the avatar transcript", async () => {
    const clock = createFakeClock();
    const stt = createFakeSTT("Tell me about leave.");
    let releaseSecondEvent!: () => void;
    const gate = new Promise<void>((resolve) => (releaseSecondEvent = resolve));

    const llm: LLMProvider = {
      name: "slow-llm",
      async *chat(_messages, opts) {
        yield { type: "text", text: "First sentence. " } as LLMStreamEvent;
        await gate; // pause here so the test can call bargeIn() mid-stream
        if (opts.signal.aborted) return;
        yield { type: "text", text: "Second sentence." } as LLMStreamEvent;
      },
    };
    const tts = createFakeTTS();
    const onTranscript = vi.fn();

    const handler = createJobHandler({
      onTranscript,
      onSentenceAudio: vi.fn(),
      now: clock.now,
      deps: { createSTT: () => stt, createLLM: () => llm, createTTS: () => tts },
    });

    driveOneUtterance(handler.pushAudioFrame, clock);
    await vi.waitFor(() => expect(tts.synthesizeCalls).toContain("First sentence."));

    handler.bargeIn();
    releaseSecondEvent();

    // Give the aborted generator's continuation a tick to (not) run.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(tts.synthesizeCalls).toEqual(["First sentence."]); // second sentence never synthesized
    expect(onTranscript).toHaveBeenCalledTimes(1); // only the user transcript — no avatar transcript for an aborted turn
    expect(onTranscript).toHaveBeenCalledWith({ role: "user", text: "Tell me about leave." });
  });

  it("automatically barges in when a new speech segment starts while a turn is still in-flight (real human interruption, not a manual bargeIn() call)", async () => {
    // Regression test for a real bug a latency review caught: onSpeechStart
    // used to only reset the recording buffer — it never touched the prior
    // turn's AbortController, which processTurn's next call would then
    // silently overwrite (not abort), leaving two turns' LLM/TTS work
    // running concurrently with no way to flush the avatar's queued audio.
    const clock = createFakeClock();
    const stt = createFakeSTT("First utterance.");
    let releaseFirstTurn!: () => void;
    const gate = new Promise<void>((resolve) => (releaseFirstTurn = resolve));

    const llm: LLMProvider = {
      name: "slow-llm",
      async *chat(_messages, opts) {
        yield { type: "text", text: "First reply sentence. " } as LLMStreamEvent;
        await gate; // pause here so the test can start a second utterance mid-turn
        if (opts.signal.aborted) return;
        yield { type: "text", text: "Should never synthesize." } as LLMStreamEvent;
      },
    };
    const tts = createFakeTTS();
    const onTranscript = vi.fn();
    const onBargeIn = vi.fn();

    const handler = createJobHandler({
      onTranscript,
      onSentenceAudio: vi.fn(),
      onBargeIn,
      now: clock.now,
      deps: { createSTT: () => stt, createLLM: () => llm, createTTS: () => tts },
    });

    driveOneUtterance(handler.pushAudioFrame, clock);
    await vi.waitFor(() => expect(tts.synthesizeCalls).toContain("First reply sentence."));
    expect(onBargeIn).not.toHaveBeenCalled(); // no in-flight turn existed when THIS utterance started

    // The human starts talking again while the first turn's LLM stream is
    // still paused — this alone (no explicit handler.bargeIn() call) must
    // abort the first turn and fire onBargeIn.
    stt.transcribe.mockResolvedValue("Second utterance, interrupting.");
    driveOneUtterance(handler.pushAudioFrame, clock);
    releaseFirstTurn();
    await vi.waitFor(() => expect(onBargeIn).toHaveBeenCalledTimes(1));

    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith({ role: "user", text: "Second utterance, interrupting." }));
    expect(tts.synthesizeCalls).not.toContain("Should never synthesize.");
  });

  it("stop() aborts any in-flight turn and ignores frames pushed afterward", async () => {
    const clock = createFakeClock();
    const stt = createFakeSTT("hello");
    const llm = createFakeLLM([{ type: "text", text: "reply." }]);
    const onTranscript = vi.fn();

    const handler = createJobHandler({
      onTranscript,
      onSentenceAudio: vi.fn(),
      now: clock.now,
      deps: { createSTT: () => stt, createLLM: () => llm, createTTS: () => createFakeTTS() },
    });

    handler.stop();
    driveOneUtterance(handler.pushAudioFrame, clock);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(stt.transcribe).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });
});
