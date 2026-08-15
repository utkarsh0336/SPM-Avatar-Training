import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, withAuthContext } from "@avatrain/shared";
import { buildApp } from "../app.js";

// Full DB-backed auth flows are covered by auth.test.ts's established
// pattern; this only checks the parts of this route that don't require a
// live database — the unauthenticated-request rejection (getSessionToken
// returns undefined before any DB lookup happens) and route registration
// itself. WS upgrade behavior (ticket validation on the actual socket
// handshake) is covered by lib/ws-tickets.test.ts's unit tests instead,
// since Fastify's `.inject()` cannot perform a real WS upgrade.
describe("conversation routes", () => {
  it("POST /v1/conversations/ticket without a session cookie returns 401", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/conversations/ticket" });
    expect(response.statusCode).toBe(401);
  });

  it("GET on the ticket route (wrong method) is not found", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/conversations/ticket" });
    expect(response.statusCode).toBe(404);
  });

  // The 503-vs-201 branching on Simli configuration is covered by
  // lib/simli.test.ts's env-injected unit tests instead of here — this
  // route reads real process.env, which varies by machine/CI, so only the
  // auth gate (true regardless of Simli config) is asserted at this layer.
  it("POST /v1/conversations/simli-session without a session cookie returns 401", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/conversations/simli-session" });
    expect(response.statusCode).toBe(401);
  });

  it("POST /v1/conversations/:trainingSessionId/livekit-connect without a session cookie returns 401", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/conversations/s1/livekit-connect" });
    expect(response.statusCode).toBe(401);
  });
});

// Auth-gate-only above (matches this file's own established convention —
// see its top comment). Plan-gating and cross-org behavior need a real DB
// and real LIVEKIT_* config, so they live in their own describe block below,
// following routes/org.test.ts's two-org-isolation pattern. The 201 success
// path (a real LiveKit room + token) is intentionally NOT exercised here —
// it would require a live LiveKit deployment; the full 201 flow is covered
// by this feature's documented manual-verification step instead.
// Cross-org session-ownership behavior (a second org addressing another
// org's trainingSessionId) is covered by training-sessions.test.ts's
// two-org isolation test instead — trainingSessionId is now a server-minted,
// RLS-scoped TrainingSession.id, so ownership is enforced by the same
// getTrainingSessionForConnect lookup (404 for another org's id) this route
// and the WS preValidation hook both call; there is no separate
// LiveKit-room-ownership concept to test anymore (see lib/livekit.ts's
// createLiveKitRoom doc comment).
describe("POST /v1/conversations/:trainingSessionId/livekit-connect — plan gating", () => {
  function uniqueEmail(label: string): string {
    return `${label}-${randomUUID()}@example.com`;
  }

  function extractToken(setCookie: string | string[] | undefined): string {
    const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const match = header?.match(/avatrain_session=([^;]+)/);
    if (!match?.[1]) throw new Error(`no session token in Set-Cookie header: ${String(header)}`);
    return decodeURIComponent(match[1]);
  }

  const createdOrgIds: string[] = [];
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const orgId of createdOrgIds) {
      await withAuthContext({ orgId }, async (tx) => {
        await tx.session.deleteMany({ where: { orgId } });
        await tx.membership.deleteMany({ where: { orgId } });
      });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    for (const orgId of createdOrgIds) {
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
  });

  const app = buildApp();
  const originalFeatureFlag = process.env.FEATURE_LIVEKIT_ENABLED;
  const originalLiveKitUrl = process.env.LIVEKIT_URL;
  const originalLiveKitKey = process.env.LIVEKIT_API_KEY;
  const originalLiveKitSecret = process.env.LIVEKIT_API_SECRET;

  afterAll(() => {
    process.env.FEATURE_LIVEKIT_ENABLED = originalFeatureFlag;
    process.env.LIVEKIT_URL = originalLiveKitUrl;
    process.env.LIVEKIT_API_KEY = originalLiveKitKey;
    process.env.LIVEKIT_API_SECRET = originalLiveKitSecret;
  });

  async function signup(orgName: string, email: string, password: string) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { orgName, email, password },
    });
    const body = response.json();
    createdOrgIds.push(body.org.id);
    createdUserIds.push(body.user.id);
    return extractToken(response.headers["set-cookie"]);
  }

  it("503s feature_disabled when FEATURE_LIVEKIT_ENABLED is not set to true", async () => {
    const token = await signup("Flag Off Org", uniqueEmail("flagoff"), "password123");
    process.env.FEATURE_LIVEKIT_ENABLED = "false";

    const response = await app.inject({
      method: "POST",
      url: "/v1/conversations/flag-off-session/livekit-connect",
      cookies: { avatrain_session: token },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("feature_disabled");
  });

  it("403s plan_not_enterprise for a default (STARTER) org, even with the feature flag on", async () => {
    process.env.FEATURE_LIVEKIT_ENABLED = "true";
    process.env.LIVEKIT_URL = "wss://test.invalid";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "test-secret";

    const token = await signup("Starter Org", uniqueEmail("starter"), "password123");

    const response = await app.inject({
      method: "POST",
      url: "/v1/conversations/starter-session/livekit-connect",
      cookies: { avatrain_session: token },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("plan_not_enterprise");
  });

  it("two-org isolation: org B stays 403 even after org A is promoted to ENTERPRISE", async () => {
    process.env.FEATURE_LIVEKIT_ENABLED = "true";
    process.env.LIVEKIT_URL = "wss://test.invalid";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "test-secret";

    const orgAToken = await signup("Org A Enterprise", uniqueEmail("orga"), "password123");
    const orgBToken = await signup("Org B Starter", uniqueEmail("orgb"), "password123");

    const me = await app.inject({ method: "GET", url: "/v1/auth/me", cookies: { avatrain_session: orgAToken } });
    await prisma.organization.update({ where: { id: me.json().org.id }, data: { plan: "ENTERPRISE" } });

    const orgBAttempt = await app.inject({
      method: "POST",
      url: "/v1/conversations/shared-session-id/livekit-connect",
      cookies: { avatrain_session: orgBToken },
    });

    expect(orgBAttempt.statusCode).toBe(403);
    expect(orgBAttempt.json().error).toBe("plan_not_enterprise");
  });
});
