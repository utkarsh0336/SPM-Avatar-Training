import { describe, expect, it } from "vitest";
import { loadAgentConfig } from "./config.js";

const validEnv = {
  LIVEKIT_URL: "wss://example.livekit.cloud",
  LIVEKIT_API_KEY: "key",
  LIVEKIT_API_SECRET: "secret",
  SIMLI_API_KEY: "simli-key",
  SIMLI_FACE_ID: "face-1",
};

describe("loadAgentConfig", () => {
  it("parses a fully-specified env", () => {
    const config = loadAgentConfig(validEnv);
    expect(config.LIVEKIT_URL).toBe("wss://example.livekit.cloud");
    expect(config.LIVEKIT_AGENT_NAME).toBe("avatrain-livekit-agent");
  });

  it("applies documented defaults for timeouts when unset", () => {
    const config = loadAgentConfig(validEnv);
    expect(config.AGENT_JOIN_TIMEOUT_MS).toBe(60_000);
    expect(config.AGENT_IDLE_TIMEOUT_MS).toBe(5 * 60_000);
    expect(config.AGENT_MAX_SESSION_MS).toBe(30 * 60_000);
    expect(config.LAST_HUMAN_GRACE_MS).toBe(15_000);
    expect(config.WORKER_CAPACITY).toBe(1);
  });

  it("coerces numeric env overrides from strings", () => {
    const config = loadAgentConfig({ ...validEnv, AGENT_JOIN_TIMEOUT_MS: "1000" });
    expect(config.AGENT_JOIN_TIMEOUT_MS).toBe(1000);
  });

  it("throws when a required var is missing", () => {
    const { SIMLI_FACE_ID: _omit, ...incomplete } = validEnv;
    expect(() => loadAgentConfig(incomplete)).toThrow();
  });
});
