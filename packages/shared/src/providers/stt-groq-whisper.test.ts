import { describe, expect, it } from "vitest";
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
});
