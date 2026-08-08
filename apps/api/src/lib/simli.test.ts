import { describe, expect, it, vi } from "vitest";
import { isSimliConfigured, mintSimliSession, resolveSimliFaceId } from "./simli.js";

describe("isSimliConfigured", () => {
  it("is false when either var is missing", () => {
    expect(isSimliConfigured({})).toBe(false);
    expect(isSimliConfigured({ SIMLI_API_KEY: "k" })).toBe(false);
    expect(isSimliConfigured({ SIMLI_FACE_ID: "f" })).toBe(false);
  });

  it("is true when both are set", () => {
    expect(isSimliConfigured({ SIMLI_API_KEY: "k", SIMLI_FACE_ID: "f" })).toBe(true);
  });
});

describe("resolveSimliFaceId", () => {
  const baseEnv = { SIMLI_API_KEY: "k", SIMLI_FACE_ID: "base-face" };

  it("returns null when Simli isn't configured at all", () => {
    expect(resolveSimliFaceId("FEMALE", {})).toBeNull();
  });

  it("returns the base face when gender is null (not yet chosen)", () => {
    expect(resolveSimliFaceId(null, baseEnv)).toBe("base-face");
  });

  it("uses the gender-specific env var when one is configured", () => {
    const env = { ...baseEnv, SIMLI_FACE_ID_MALE: "male-face", SIMLI_FACE_ID_NEUTRAL: "neutral-face" };
    expect(resolveSimliFaceId("MALE", env)).toBe("male-face");
    expect(resolveSimliFaceId("NEUTRAL", env)).toBe("neutral-face");
  });

  it("falls back to the base face when the gender-specific override isn't set", () => {
    // Mirrors the actual configuration: SIMLI_FACE_ID_FEMALE was never
    // added since the original single SIMLI_FACE_ID already renders a
    // female-presenting face.
    const env = { ...baseEnv, SIMLI_FACE_ID_MALE: "male-face" };
    expect(resolveSimliFaceId("FEMALE", env)).toBe("base-face");
  });
});

describe("mintSimliSession", () => {
  it("throws when unconfigured, without calling the vendor SDK", async () => {
    const generateToken = vi.fn();
    const generateIce = vi.fn();
    await expect(mintSimliSession({ env: {}, generateToken, generateIce })).rejects.toThrow(
      /SIMLI_API_KEY and SIMLI_FACE_ID/,
    );
    expect(generateToken).not.toHaveBeenCalled();
    expect(generateIce).not.toHaveBeenCalled();
  });

  it("calls the vendor SDK for both the token and ICE servers, returning both", async () => {
    const generateToken = vi.fn().mockResolvedValue({ session_token: "tok_abc" });
    const iceServers = [{ urls: "stun:stun.simli.ai:3478" }];
    const generateIce = vi.fn().mockResolvedValue(iceServers);

    const session = await mintSimliSession({
      env: { SIMLI_API_KEY: "k", SIMLI_FACE_ID: "f" },
      generateToken,
      generateIce,
    });

    expect(session).toEqual({ sessionToken: "tok_abc", iceServers });
    expect(generateToken).toHaveBeenCalledWith({
      apiKey: "k",
      config: { faceId: "f", handleSilence: true, maxSessionLength: 600, maxIdleTime: 60 },
    });
    expect(generateIce).toHaveBeenCalledWith("k");
  });

  it("honors SIMLI_MAX_SESSION_SECONDS / SIMLI_MAX_IDLE_SECONDS overrides", async () => {
    const generateToken = vi.fn().mockResolvedValue({ session_token: "tok_abc" });
    const generateIce = vi.fn().mockResolvedValue([]);
    await mintSimliSession({
      env: {
        SIMLI_API_KEY: "k",
        SIMLI_FACE_ID: "f",
        SIMLI_MAX_SESSION_SECONDS: "120",
        SIMLI_MAX_IDLE_SECONDS: "30",
      },
      generateToken,
      generateIce,
    });

    expect(generateToken).toHaveBeenCalledWith({
      apiKey: "k",
      config: { faceId: "f", handleSilence: true, maxSessionLength: 120, maxIdleTime: 30 },
    });
  });

  it("uses the explicit faceId override instead of env.SIMLI_FACE_ID when provided", async () => {
    const generateToken = vi.fn().mockResolvedValue({ session_token: "tok_abc" });
    const generateIce = vi.fn().mockResolvedValue([]);
    await mintSimliSession({
      env: { SIMLI_API_KEY: "k", SIMLI_FACE_ID: "env-default-face" },
      faceId: "pinned-avatar-face",
      generateToken,
      generateIce,
    });

    expect(generateToken).toHaveBeenCalledWith({
      apiKey: "k",
      config: { faceId: "pinned-avatar-face", handleSilence: true, maxSessionLength: 600, maxIdleTime: 60 },
    });
  });

  it("falls back to env.SIMLI_FACE_ID when the override is null (e.g. no avatar has a face yet)", async () => {
    const generateToken = vi.fn().mockResolvedValue({ session_token: "tok_abc" });
    const generateIce = vi.fn().mockResolvedValue([]);
    await mintSimliSession({
      env: { SIMLI_API_KEY: "k", SIMLI_FACE_ID: "env-default-face" },
      faceId: null,
      generateToken,
      generateIce,
    });

    expect(generateToken).toHaveBeenCalledWith({
      apiKey: "k",
      config: { faceId: "env-default-face", handleSilence: true, maxSessionLength: 600, maxIdleTime: 60 },
    });
  });
});
