import { describe, expect, it } from "vitest";
import { loadApiConfig } from "./config.js";

describe("loadApiConfig", () => {
  it("parses an empty env — every field is optional/defaulted so buildApp() never breaks on missing config", () => {
    const config = loadApiConfig({});
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.SENTRY_DSN).toBeUndefined();
    expect(config.INTERNAL_OPS_TOKEN).toBeUndefined();
  });

  it("accepts an optional SENTRY_DSN", () => {
    const config = loadApiConfig({ SENTRY_DSN: "https://key@o0.ingest.sentry.io/1" });
    expect(config.SENTRY_DSN).toBe("https://key@o0.ingest.sentry.io/1");
  });

  it("accepts a well-formed INTERNAL_OPS_TOKEN", () => {
    const token = "a".repeat(32);
    const config = loadApiConfig({ INTERNAL_OPS_TOKEN: token });
    expect(config.INTERNAL_OPS_TOKEN).toBe(token);
  });

  it("throws when INTERNAL_OPS_TOKEN is shorter than 32 characters", () => {
    expect(() => loadApiConfig({ INTERNAL_OPS_TOKEN: "too-short" })).toThrow();
  });

  it("throws on an unrecognized LOG_LEVEL", () => {
    expect(() => loadApiConfig({ LOG_LEVEL: "verbose" })).toThrow();
  });
});
