import { describe, expect, it } from "vitest";
import { createSTTProviderFromEnv, resolveWhisperLanguageCode } from "./stt-factory.js";

describe("createSTTProviderFromEnv", () => {
  it("returns null when GROQ_API_KEY is not configured", () => {
    expect(createSTTProviderFromEnv({})).toBeNull();
  });

  it("returns a groq-whisper provider when GROQ_API_KEY is configured", () => {
    const provider = createSTTProviderFromEnv({ GROQ_API_KEY: "k" });
    expect(provider?.name).toBe("groq-whisper");
  });
});

describe("resolveWhisperLanguageCode", () => {
  it("resolves the ISO-639-1 code for every wired language", () => {
    expect(resolveWhisperLanguageCode("English")).toBe("en");
    expect(resolveWhisperLanguageCode("Hindi")).toBe("hi");
    expect(resolveWhisperLanguageCode("Spanish")).toBe("es");
  });
});
