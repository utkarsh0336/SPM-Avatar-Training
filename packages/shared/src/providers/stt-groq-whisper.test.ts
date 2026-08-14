import { describe, expect, it, vi } from "vitest";
import { createGroqWhisperSTTProvider } from "./stt-groq-whisper.js";

describe("createGroqWhisperSTTProvider", () => {
  it("posts multipart form data with the audio file and model, returns the transcript", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ text: "hello world" }), { status: 200 });
    };
    const provider = createGroqWhisperSTTProvider({ apiKey: "secret", fetchImpl });

    const result = await provider.transcribe(new Uint8Array([1, 2, 3]), "audio/wav");

    expect(result).toBe("hello world");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret");
    expect(capturedInit?.body).toBeInstanceOf(FormData);
    const form = capturedInit?.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("forwards a language hint as Whisper's ISO-639-1 `language` form field when given", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ text: "नमस्ते" }), { status: 200 });
    };
    const provider = createGroqWhisperSTTProvider({ apiKey: "secret", fetchImpl });

    await provider.transcribe(new Uint8Array([1, 2, 3]), "audio/wav", { language: "hi" });

    const form = capturedInit?.body as FormData;
    expect(form.get("language")).toBe("hi");
  });

  it("omits the `language` form field entirely when no hint is given", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ text: "hello" }), { status: 200 });
    };
    const provider = createGroqWhisperSTTProvider({ apiKey: "secret", fetchImpl });

    await provider.transcribe(new Uint8Array([1, 2, 3]), "audio/wav");

    const form = capturedInit?.body as FormData;
    expect(form.get("language")).toBeNull();
  });

  it("returns an empty string when the API returns no text field", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({}), { status: 200 });
    const provider = createGroqWhisperSTTProvider({ apiKey: "k", fetchImpl });
    expect(await provider.transcribe(new Uint8Array([1]), "audio/wav")).toBe("");
  });

  it("throws a classified ProviderError on failure", async () => {
    const fetchImpl = async () => new Response("bad request", { status: 400 });
    const provider = createGroqWhisperSTTProvider({ apiKey: "k", fetchImpl });
    await expect(provider.transcribe(new Uint8Array([1]), "audio/wav")).rejects.toMatchObject({
      kind: "other",
      provider: "groq-whisper",
    });
  });

  it("throws a rate_limited ProviderError on a 429", async () => {
    const fetchImpl = async () => new Response("slow down", { status: 429 });
    const provider = createGroqWhisperSTTProvider({ apiKey: "k", fetchImpl });
    await expect(provider.transcribe(new Uint8Array([1]), "audio/wav")).rejects.toMatchObject({
      kind: "rate_limited",
    });
  });

  it("forwards a domain-vocabulary `prompt` form field when given", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ text: "hello" }), { status: 200 });
    };
    const provider = createGroqWhisperSTTProvider({ apiKey: "secret", fetchImpl });

    await provider.transcribe(new Uint8Array([1, 2, 3]), "audio/wav", { prompt: "HR & Leave Policy" });

    const form = capturedInit?.body as FormData;
    expect(form.get("prompt")).toBe("HR & Leave Policy");
  });

  it("omits the `prompt` form field entirely when no bias is given", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ text: "hello" }), { status: 200 });
    };
    const provider = createGroqWhisperSTTProvider({ apiKey: "secret", fetchImpl });

    await provider.transcribe(new Uint8Array([1, 2, 3]), "audio/wav");

    const form = capturedInit?.body as FormData;
    expect(form.get("prompt")).toBeNull();
  });

  it("always requests verbose_json, with or without a prompt", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ text: "hello" }), { status: 200 });
    };
    const provider = createGroqWhisperSTTProvider({ apiKey: "secret", fetchImpl });

    await provider.transcribe(new Uint8Array([1, 2, 3]), "audio/wav");
    expect((capturedInit?.body as FormData).get("response_format")).toBe("verbose_json");

    await provider.transcribe(new Uint8Array([1, 2, 3]), "audio/wav", { prompt: "topic" });
    expect((capturedInit?.body as FormData).get("response_format")).toBe("verbose_json");
  });

  it("still returns the top-level `text` field from a verbose_json-shaped response", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          text: "hello world",
          segments: [{ avg_logprob: -0.1, no_speech_prob: 0.01 }],
        }),
        { status: 200 },
      );
    const provider = createGroqWhisperSTTProvider({ apiKey: "k", fetchImpl });
    expect(await provider.transcribe(new Uint8Array([1]), "audio/wav")).toBe("hello world");
  });

  it("logs stt_confidence telemetry when segments are present, without affecting the returned transcript", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const fetchImpl = async () =>
        new Response(
          JSON.stringify({
            text: "hello world",
            segments: [
              { avg_logprob: -0.1, no_speech_prob: 0.01 },
              { avg_logprob: -0.3, no_speech_prob: 0.05 },
            ],
          }),
          { status: 200 },
        );
      const provider = createGroqWhisperSTTProvider({ apiKey: "k", fetchImpl });
      const result = await provider.transcribe(new Uint8Array([1]), "audio/wav");

      expect(result).toBe("hello world");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(logged.event).toBe("stt_confidence");
      expect(logged.provider).toBe("groq-whisper");
      expect(logged.avgLogprob).toBeCloseTo(-0.2);
      expect(logged.noSpeechProb).toBeCloseTo(0.03);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("does not log or throw when segments are absent (back-compat with plain {text} fixtures)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const fetchImpl = async () => new Response(JSON.stringify({ text: "hello" }), { status: 200 });
      const provider = createGroqWhisperSTTProvider({ apiKey: "k", fetchImpl });
      const result = await provider.transcribe(new Uint8Array([1]), "audio/wav");

      expect(result).toBe("hello");
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
