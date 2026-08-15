import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, withAuthContext } from "@avatrain/shared";
import { buildApp } from "../app.js";

function extractToken(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = header?.match(/avatrain_session=([^;]+)/);
  if (!match?.[1]) throw new Error(`no session token in Set-Cookie header: ${String(header)}`);
  return decodeURIComponent(match[1]);
}

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.com`;
}

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
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
}

afterAll(cleanup);

const app = buildApp();

// Unique remoteAddress per call: checkRateLimit's signup:${request.ip} bucket now lives in real
// Redis (packages/shared/src/scaling/rate-limiter.ts), shared across every parallel test file in
// the run, not reset per-process like the old in-memory Map — same reasoning as auth.test.ts's
// seedPasswordUser comment. Without this, this file's own signup() calls would pool against every
// other test file's and eventually trip "rate_limited".
async function signup(orgName: string, email: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { orgName, email, password },
    remoteAddress: randomUUID(),
  });
  const body = response.json();
  createdOrgIds.push(body.org.id);
  createdUserIds.push(body.user.id);
  return response;
}

async function inviteAndAcceptMember(ownerToken: string): Promise<string> {
  const inviteeEmail = uniqueEmail("member");
  const inviteResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/invite",
    cookies: { avatrain_session: ownerToken },
    payload: { email: inviteeEmail },
  });
  const { inviteUrl } = inviteResponse.json();
  const inviteToken = new URL(inviteUrl, "http://localhost").searchParams.get("token");
  const acceptResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/accept-invite",
    payload: { token: inviteToken, password: "memberPassword123" },
  });
  const acceptBody = acceptResponse.json();
  createdUserIds.push(acceptBody.user.id);
  return extractToken(acceptResponse.headers["set-cookie"]);
}

describe("PATCH /v1/org/branding", () => {
  it("403s for a MEMBER caller, 200s for OWNER, and the update shows up on a later /me", async () => {
    const ownerEmail = uniqueEmail("owner");
    const signupResponse = await signup("Acme Corp", ownerEmail, "password123");
    const ownerToken = extractToken(signupResponse.headers["set-cookie"]);

    const memberToken = await inviteAndAcceptMember(ownerToken);
    const memberAttempt = await app.inject({
      method: "PATCH",
      url: "/v1/org/branding",
      cookies: { avatrain_session: memberToken },
      payload: { primaryColorHex: "#8B5CF6" },
    });
    expect(memberAttempt.statusCode).toBe(403);

    const ownerUpdate = await app.inject({
      method: "PATCH",
      url: "/v1/org/branding",
      cookies: { avatrain_session: ownerToken },
      payload: {
        logoUrl: "https://cdn.example.com/logo.png",
        primaryColorHex: "#8B5CF6",
        secondaryColorHex: "#3B82F6",
      },
    });
    expect(ownerUpdate.statusCode).toBe(200);
    expect(ownerUpdate.json()).toMatchObject({
      logoUrl: "https://cdn.example.com/logo.png",
      primaryColorHex: "#8B5CF6",
      secondaryColorHex: "#3B82F6",
    });

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      cookies: { avatrain_session: ownerToken },
    });
    expect(me.json().org).toMatchObject({
      logoUrl: "https://cdn.example.com/logo.png",
      primaryColorHex: "#8B5CF6",
      secondaryColorHex: "#3B82F6",
    });
  });

  it("rejects an invalid hex color with 400", async () => {
    const ownerEmail = uniqueEmail("owner-invalid");
    const signupResponse = await signup("Invalid Color Org", ownerEmail, "password123");
    const ownerToken = extractToken(signupResponse.headers["set-cookie"]);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/org/branding",
      cookies: { avatrain_session: ownerToken },
      payload: { primaryColorHex: "not-a-color" },
    });
    expect(response.statusCode).toBe(400);
  });

  describe("two-org isolation", () => {
    it("org B's OWNER branding update never affects org A", async () => {
      const orgAOwnerEmail = uniqueEmail("orga-owner");
      const orgASignup = await signup("Org A", orgAOwnerEmail, "password123");
      const orgAToken = extractToken(orgASignup.headers["set-cookie"]);

      const orgBOwnerEmail = uniqueEmail("orgb-owner");
      const orgBSignup = await signup("Org B", orgBOwnerEmail, "password123");
      const orgBToken = extractToken(orgBSignup.headers["set-cookie"]);

      const orgBUpdate = await app.inject({
        method: "PATCH",
        url: "/v1/org/branding",
        cookies: { avatrain_session: orgBToken },
        payload: { primaryColorHex: "#111111" },
      });
      expect(orgBUpdate.statusCode).toBe(200);

      const orgAMe = await app.inject({
        method: "GET",
        url: "/v1/auth/me",
        cookies: { avatrain_session: orgAToken },
      });
      expect(orgAMe.json().org.primaryColorHex).toBeNull();
    });
  });
});
