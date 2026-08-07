import { describe, expect, it } from "vitest";
import { recognizeOnce, type SpeechRecognitionLike } from "./web-speech-fallback.js";

function createFakeRecognition(): SpeechRecognitionLike & { started: boolean } {
  return {
    lang: "",
    continuous: true,
    interimResults: true,
    started: false,
    onresult: null,
    onerror: null,
    onend: null,
    start() {
      this.started = true;
    },
    stop() {},
  };
}

describe("recognizeOnce", () => {
  it("configures the recognition for a single non-interim result and starts it", async () => {
    const recognition = createFakeRecognition();
    const promise = recognizeOnce({ createRecognition: () => recognition });

    expect(recognition.continuous).toBe(false);
    expect(recognition.interimResults).toBe(false);
    expect(recognition.started).toBe(true);

    recognition.onresult?.({ results: [[{ transcript: "hello there" }]] });
    await expect(promise).resolves.toEqual({ text: "hello there" });
  });

  it("rejects on a recognition error", async () => {
    const recognition = createFakeRecognition();
    const promise = recognizeOnce({ createRecognition: () => recognition });
    recognition.onerror?.({ error: "no-speech" });
    await expect(promise).rejects.toThrow("no-speech");
  });

  it("rejects if recognition ends with no result rather than hanging forever", async () => {
    const recognition = createFakeRecognition();
    const promise = recognizeOnce({ createRecognition: () => recognition });
    recognition.onend?.();
    await expect(promise).rejects.toThrow("web_speech_no_result");
  });

  it("does not reject on end after a result already resolved the promise", async () => {
    const recognition = createFakeRecognition();
    const promise = recognizeOnce({ createRecognition: () => recognition });
    recognition.onresult?.({ results: [[{ transcript: "done" }]] });
    recognition.onend?.();
    await expect(promise).resolves.toEqual({ text: "done" });
  });

  it("rejects immediately when no SpeechRecognition implementation is available", async () => {
    await expect(recognizeOnce({ createRecognition: () => null })).rejects.toThrow(
      "web_speech_api_unavailable",
    );
  });
});
