import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma, setAuthContext, withAuthContext } from "@avatrain/shared";
import { buildApp } from "../app.js";

// exchangeGoogleCode does a real network round-trip to Google in production;
// mocked here so the route's account-resolution logic (the part this file
// actually needs to verify) can be tested without hitting Google's network.
const { exchangeGoogleCode } = vi.hoisted(() => ({ exchangeGoogleCode: vi.fn() }));
vi.mock("@avatrain/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@avatrain/shared")>();
  return { ...actual, exchangeGoogleCode };
});

function extractToken(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = header?.match(/avatrain_session=([^;]+)/);
  if (!match?.[1]) throw new Error(`no session token in Set-Cookie header: ${String(header)}`);
  return decodeURIComponent(match[1]);
}

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.com`;
}

function uniqueGoogleSub(label: string): string {
  return `google-sub-${label}-${randomUUID()}`;
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
    await prisma.oAuthAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
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

interface GoogleProfileInput {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

// Seeds preconditions directly via Prisma rather than the real HTTP
// signup/invite routes — those share a single per-process signup/login rate
// limit bucket keyed by request.ip, and app.inject() always reports the
// same synthetic IP. Routing every precondition through the real endpoints
// would make this file's total signup count flaky against that shared
// bucket; seeding directly also isolates these tests to the Google-login
// logic under test, independent of signup()/invite()'s own (separately
// tested) behavior.
async function seedPasswordUser(orgName: string, email: string): Promise<{ userId: string; orgId: string }> {
  const orgId = randomUUID();
  const userId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: orgName } });
    await tx.user.create({ data: { id: userId, email, passwordHash: "seeded-hash-not-used-by-google-login" } });
    await setAuthContext(tx, { userId, orgId });
    await tx.membership.create({ data: { orgId, userId, role: "OWNER" } });
  });
  createdOrgIds.push(orgId);
  createdUserIds.push(userId);
  return { userId, orgId };
}

async function seedPendingInvitee(orgName: string, email: string): Promise<{ orgId: string }> {
  const orgId = randomUUID();
  const ownerUserId = randomUUID();
  const inviteeUserId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: orgName } });
    await tx.user.create({
      data: { id: ownerUserId, email: uniqueEmail(`${orgName}-owner`), passwordHash: "seeded" },
    });
    await setAuthContext(tx, { userId: ownerUserId, orgId });
    await tx.membership.create({ data: { orgId, userId: ownerUserId, role: "OWNER" } });
    await tx.user.create({ data: { id: inviteeUserId, email, status: "PENDING" } });
    await setAuthContext(tx, { userId: inviteeUserId, orgId });
    await tx.membership.create({ data: { orgId, userId: inviteeUserId, role: "MEMBER" } });
  });
  createdOrgIds.push(orgId);
  createdUserIds.push(ownerUserId, inviteeUserId);
  return { orgId };
}

async function googleLogin(profile: GoogleProfileInput) {
  exchangeGoogleCode.mockResolvedValueOnce(profile);
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/google/callback",
    payload: { code: "test-code", codeVerifier: "test-verifier" },
  });
  if (response.statusCode === 200) {
    const body = response.json();
    if (!createdOrgIds.includes(body.org.id)) createdOrgIds.push(body.org.id);
    if (!createdUserIds.includes(body.user.id)) createdUserIds.push(body.user.id);
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

    it("invites a PARTNER when role is specified, and rejects role: OWNER", async () => {
      const { ownerToken } = await setupOwner();
      const partnerEmail = uniqueEmail("partner");

      const rejectedOwnerRole = await app.inject({
        method: "POST",
        url: "/v1/auth/invite",
        cookies: { avatrain_session: ownerToken },
        payload: { email: partnerEmail, role: "OWNER" },
      });
      expect(rejectedOwnerRole.statusCode).toBe(400);

      const partnerInvite = await app.inject({
        method: "POST",
        url: "/v1/auth/invite",
        cookies: { avatrain_session: ownerToken },
        payload: { email: partnerEmail, role: "PARTNER" },
      });
      expect(partnerInvite.statusCode).toBe(201);
      const inviteToken = new URL(partnerInvite.json().inviteUrl, "http://localhost").searchParams.get("token");

      const acceptResponse = await app.inject({
        method: "POST",
        url: "/v1/auth/accept-invite",
        payload: { token: inviteToken, password: "partnerPassword123" },
      });
      expect(acceptResponse.statusCode).toBe(200);
      expect(acceptResponse.json()).toMatchObject({ role: "PARTNER" });
      createdUserIds.push(acceptResponse.json().user.id);
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

  describe("POST /v1/auth/google/callback", () => {
    it("self-serve creates a new Organization + User(OWNER) for a brand-new verified email", async () => {
      const email = uniqueEmail("google-new");
      const response = await googleLogin({
        sub: uniqueGoogleSub("new"),
        email,
        emailVerified: true,
        name: "Ada Lovelace",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        user: { email, onboardingCompletedAt: null },
        role: "OWNER",
      });
      expect(response.headers["set-cookie"]).toBeDefined();
    });

    it("logs into the same account on a repeat sign-in, without creating a duplicate org/user", async () => {
      const sub = uniqueGoogleSub("repeat");
      const email = uniqueEmail("google-repeat");

      const first = await googleLogin({ sub, email, emailVerified: true });
      const second = await googleLogin({ sub, email, emailVerified: true });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().user.id).toBe(first.json().user.id);
      expect(second.json().org.id).toBe(first.json().org.id);
    });

    it("links to an existing password-only User by verified email, reusing their org", async () => {
      const email = uniqueEmail("google-link");
      const { userId, orgId } = await seedPasswordUser("Password Org", email);

      const response = await googleLogin({
        sub: uniqueGoogleSub("link"),
        email,
        emailVerified: true,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.user.id).toBe(userId);
      expect(body.org.id).toBe(orgId);
      expect(body.role).toBe("OWNER");
    });

    it("activates a PENDING invited member on a verified Google sign-in, without a password", async () => {
      const inviteeEmail = uniqueEmail("google-invitee");
      await seedPendingInvitee("Invite Org", inviteeEmail);

      const response = await googleLogin({
        sub: uniqueGoogleSub("invitee"),
        email: inviteeEmail,
        emailVerified: true,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.user.email).toBe(inviteeEmail);
      expect(body.role).toBe("MEMBER");

      const user = await prisma.user.findUniqueOrThrow({ where: { email: inviteeEmail } });
      expect(user.status).toBe("ACTIVE");
    });

    it("rejects a brand-new email whose Google profile is not email_verified", async () => {
      const response = await googleLogin({
        sub: uniqueGoogleSub("unverified"),
        email: uniqueEmail("google-unverified"),
        emailVerified: false,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty("error", "google_email_not_verified");
    });

    it("never auto-links an unverified Google profile to an existing password account", async () => {
      const email = uniqueEmail("google-unverified-link");
      await seedPasswordUser("Targeted Org", email);

      const response = await googleLogin({
        sub: uniqueGoogleSub("unverified-link"),
        email,
        emailVerified: false,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toHaveProperty("error", "google_email_not_verified");
    });

    it("maps a failed code exchange to a generic error, never the raw exchange error", async () => {
      exchangeGoogleCode.mockRejectedValueOnce(new Error("token exchange failed upstream"));

      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/google/callback",
        payload: { code: "bad-code", codeVerifier: "verifier" },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body).toMatchObject({ error: "google_auth_failed" });
      // Never the underlying exchange error's message — see
      // apps/api/src/routes/auth.ts's try/catch around exchangeGoogleCode.
      expect(JSON.stringify(body)).not.toContain("token exchange failed upstream");
    });
  });
});
