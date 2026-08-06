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

async function signup(orgName: string, email: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { orgName, email, password },
  });
  if (response.statusCode === 201) {
    const body = response.json();
    createdOrgIds.push(body.org.id);
    createdUserIds.push(body.user.id);
  }
  return response;
}

describe("auth routes", () => {
  describe("POST /v1/auth/signup", () => {
    it("creates org + user + membership + session and sets a cookie", async () => {
      const email = uniqueEmail("signup");
      const response = await signup("Acme", email, "password123");

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        user: { email },
        org: { name: "Acme" },
        role: "OWNER",
      });

      const setCookie = response.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieHeader).toContain("HttpOnly");

      const token = extractToken(setCookie);
      const me = await app.inject({
        method: "GET",
        url: "/v1/auth/me",
        cookies: { avatrain_session: token },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({ user: { email }, role: "OWNER" });
    });

    it("rejects a duplicate email with 409", async () => {
      const email = uniqueEmail("dup");
      const first = await signup("Acme", email, "password123");
      expect(first.statusCode).toBe(201);

      const second = await signup("Other Org", email, "password456");
      expect(second.statusCode).toBe(409);
      expect(second.json()).toHaveProperty("error");
    });
  });

  describe("POST /v1/auth/login", () => {
    it("succeeds with correct credentials", async () => {
      const email = uniqueEmail("login");
      await signup("Acme", email, "password123");

      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email, password: "password123" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["set-cookie"]).toBeDefined();
    });

    it("returns an identical 401 shape for wrong password and unknown email", async () => {
      const email = uniqueEmail("wrongpw");
      await signup("Acme", email, "password123");

      const wrongPassword = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email, password: "not-the-password" },
      });
      const unknownEmail = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: uniqueEmail("nobody"), password: "irrelevant" },
      });

      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(401);
      expect(wrongPassword.json()).toEqual(unknownEmail.json());
    });
  });

  describe("POST /v1/auth/logout", () => {
    it("is idempotent and always returns { ok: true }", async () => {
      const withoutCookie = await app.inject({ method: "POST", url: "/v1/auth/logout" });
      expect(withoutCookie.statusCode).toBe(200);
      expect(withoutCookie.json()).toEqual({ ok: true });

      const twice = await app.inject({ method: "POST", url: "/v1/auth/logout" });
      expect(twice.statusCode).toBe(200);
      expect(twice.json()).toEqual({ ok: true });
    });

    it("invalidates the session so a later /me with the same cookie is 401", async () => {
      const email = uniqueEmail("logout");
      const signupResponse = await signup("Acme", email, "password123");
      const token = extractToken(signupResponse.headers["set-cookie"]);

      const logoutResponse = await app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        cookies: { avatrain_session: token },
      });
      expect(logoutResponse.statusCode).toBe(200);

      const me = await app.inject({
        method: "GET",
        url: "/v1/auth/me",
        cookies: { avatrain_session: token },
      });
      expect(me.statusCode).toBe(401);
    });
  });

  describe("GET /v1/auth/me", () => {
    it("returns 401 without a cookie", async () => {
      const response = await app.inject({ method: "GET", url: "/v1/auth/me" });
      expect(response.statusCode).toBe(401);
    });

    it("returns 200 with a valid cookie", async () => {
      const email = uniqueEmail("me");
      const signupResponse = await signup("Acme", email, "password123");
      const token = extractToken(signupResponse.headers["set-cookie"]);

      const response = await app.inject({
        method: "GET",
        url: "/v1/auth/me",
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ user: { email }, role: "OWNER" });
    });
  });

  describe("invite / accept-invite", () => {
    async function setupOwner() {
      const ownerEmail = uniqueEmail("owner");
      const signupResponse = await signup("Acme", ownerEmail, "password123");
      const ownerToken = extractToken(signupResponse.headers["set-cookie"]);
      return { ownerEmail, ownerToken };
    }

    it("403s for a MEMBER caller, 201s for OWNER, 409s for an existing email", async () => {
      const { ownerToken } = await setupOwner();
      const inviteeEmail = uniqueEmail("invitee");

      const ownerInvite = await app.inject({
        method: "POST",
        url: "/v1/auth/invite",
        cookies: { avatrain_session: ownerToken },
        payload: { email: inviteeEmail },
      });
      expect(ownerInvite.statusCode).toBe(201);
      const { inviteUrl } = ownerInvite.json();
      const inviteToken = new URL(inviteUrl, "http://localhost").searchParams.get("token");
      expect(inviteToken).toBeTruthy();

      const dupeInvite = await app.inject({
        method: "POST",
        url: "/v1/auth/invite",
        cookies: { avatrain_session: ownerToken },
        payload: { email: inviteeEmail },
      });
      expect(dupeInvite.statusCode).toBe(409);

      const acceptResponse = await app.inject({
        method: "POST",
        url: "/v1/auth/accept-invite",
        payload: { token: inviteToken, password: "memberPassword123" },
      });
      expect(acceptResponse.statusCode).toBe(200);
      const acceptBody = acceptResponse.json();
      expect(acceptBody).toMatchObject({
        user: { email: inviteeEmail },
        role: "MEMBER",
      });
      // invite() creates the User row directly (not via signup()), so it's
      // never added to createdUserIds automatically — track it here.
      createdUserIds.push(acceptBody.user.id);
      const memberToken = extractToken(acceptResponse.headers["set-cookie"]);

      const memberInviteAttempt = await app.inject({
        method: "POST",
        url: "/v1/auth/invite",
        cookies: { avatrain_session: memberToken },
        payload: { email: uniqueEmail("another") },
      });
      expect(memberInviteAttempt.statusCode).toBe(403);
    });

    it("rejects an invalid accept-invite token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/accept-invite",
        payload: { token: "not-a-real-token", password: "password123" },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /v1/auth/members — two-org isolation", () => {
    it("only returns the caller's own org's members, never another org's", async () => {
      const orgAOwnerEmail = uniqueEmail("orga-owner");
      const orgASignup = await signup("Org A", orgAOwnerEmail, "password123");
      const orgAToken = extractToken(orgASignup.headers["set-cookie"]);

      const orgBOwnerEmail = uniqueEmail("orgb-owner");
      await signup("Org B", orgBOwnerEmail, "password123");

      const response = await app.inject({
        method: "GET",
        url: "/v1/auth/members",
        cookies: { avatrain_session: orgAToken },
      });
      expect(response.statusCode).toBe(200);
      const { members } = response.json();
      expect(members).toHaveLength(1);
      expect(members[0].email).toBe(orgAOwnerEmail);
      expect(members.some((m: { email: string }) => m.email === orgBOwnerEmail)).toBe(false);
    });
  });
});
