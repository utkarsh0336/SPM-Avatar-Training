import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdToken = vi.fn();
const getToken = vi.fn();

vi.mock("google-auth-library", () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({ verifyIdToken, getToken })),
}));

const { exchangeGoogleCode, verifyGoogleIdToken } = await import("./google.js");

const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] as const;

describe("google", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_REDIRECT_URI = "https://dashboard.example.com/api/auth/google/callback";
    verifyIdToken.mockReset();
    getToken.mockReset();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  describe("verifyGoogleIdToken", () => {
    it("returns the profile from a valid token", async () => {
      verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: "google-sub-123",
          email: "User@Example.com",
          email_verified: true,
          name: "Test User",
        }),
      });

      await expect(verifyGoogleIdToken("valid-id-token")).resolves.toEqual({
        sub: "google-sub-123",
        email: "user@example.com",
        emailVerified: true,
        name: "Test User",
      });
    });

    it("marks emailVerified false when Google didn't verify it", async () => {
      verifyIdToken.mockResolvedValue({
        getPayload: () => ({ sub: "s", email: "a@b.com", email_verified: false }),
      });
      const profile = await verifyGoogleIdToken("token");
      expect(profile.emailVerified).toBe(false);
    });

    it("rejects when the payload has no sub or email", async () => {
      verifyIdToken.mockResolvedValue({ getPayload: () => ({ email_verified: true }) });
      await expect(verifyGoogleIdToken("token")).rejects.toThrow("invalid_google_id_token");
    });

    it("rejects when verification throws (expired token / bad signature / wrong audience)", async () => {
      verifyIdToken.mockRejectedValue(new Error("Token used too late"));
      await expect(verifyGoogleIdToken("expired-token")).rejects.toThrow("Token used too late");
    });

    it("throws when Google env config is missing", async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      await expect(verifyGoogleIdToken("token")).rejects.toThrow(/not configured/);
    });
  });

  describe("exchangeGoogleCode", () => {
    it("exchanges the code and verifies the returned id_token", async () => {
      getToken.mockResolvedValue({ tokens: { id_token: "the-id-token" } });
      verifyIdToken.mockResolvedValue({
        getPayload: () => ({ sub: "s", email: "a@b.com", email_verified: true }),
      });

      const profile = await exchangeGoogleCode("auth-code", "verifier");
      expect(getToken).toHaveBeenCalledWith(
        expect.objectContaining({ code: "auth-code", codeVerifier: "verifier" }),
      );
      expect(profile.sub).toBe("s");
    });

    it("rejects when the token response has no id_token", async () => {
      getToken.mockResolvedValue({ tokens: {} });
      await expect(exchangeGoogleCode("auth-code", "verifier")).rejects.toThrow(
        "google_token_exchange_failed",
      );
    });
  });
});
