import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { generateOpaqueToken, prisma, setAuthContext, sha256Hex, withAuthContext } from "@avatrain/shared";
import { buildApp } from "../app.js";

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.com`;
}

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const orgId of createdOrgIds) {
    await withAuthContext({ orgId }, async (tx) => {
      await tx.avatar.deleteMany({ where: { orgId } });
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

// Seeds org + user + membership + session directly via Prisma rather than
// the real HTTP signup route — every app.inject() call reports the same
// synthetic IP, so all signups in this file would otherwise share one
// `signup:${ip}` rate-limit bucket (max 10/60s) and start 401ing partway
// through the suite. Same workaround auth.test.ts already documents/uses.
interface SeededOrg {
  token: string;
  userId: string;
  orgId: string;
}

async function seedOrgWithSessionToken(orgName: string): Promise<SeededOrg> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const token = generateOpaqueToken();
  const tokenHash = sha256Hex(token);

  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: orgName } });
    await tx.user.create({ data: { id: userId, email: uniqueEmail(orgName), passwordHash: "seeded" } });
    await setAuthContext(tx, { userId, orgId });
    await tx.membership.create({ data: { orgId, userId, role: "OWNER" } });
    await tx.session.create({
      data: { orgId, userId, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
  });

  createdOrgIds.push(orgId);
  createdUserIds.push(userId);
  return { token, userId, orgId };
}

const FULL_VALID_PATCH = {
  name: "My Avatar",
  style: "REALISTIC",
  gender: "FEMALE",
  skinTone: "TONE_2",
  hairStyle: "MEDIUM",
  hairColor: "AUBURN",
  outfit: "BUSINESS_FORMAL",
  expertise: "HR_LEAVE_POLICY",
  voice: "NEUTRAL",
};

describe("onboarding routes", () => {
  describe("GET /v1/onboarding", () => {
    it("requires authentication", async () => {
      const response = await app.inject({ method: "GET", url: "/v1/onboarding" });
      expect(response.statusCode).toBe(401);
    });

    it("get-or-creates a draft with sensible defaults", async () => {
      const { token } = await seedOrgWithSessionToken("Onboarding GET Org");
      const response = await app.inject({
        method: "GET",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "DRAFT",
        lastVisitedStep: 1,
        previewProvider: "NONE",
        name: null,
        avatarModelUrl: null,
      });
    });

    it("is idempotent — a second GET returns the same draft, not a new one", async () => {
      const { token } = await seedOrgWithSessionToken("Onboarding Idempotent Org");
      const first = await app.inject({
        method: "GET",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
      });
      await app.inject({
        method: "PATCH",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
        payload: { name: "Kept Across Calls" },
      });
      const second = await app.inject({
        method: "GET",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().name).toBe("Kept Across Calls");
    });
  });

  describe("PATCH /v1/onboarding", () => {
    it("partially updates without requiring full-step completeness", async () => {
      const { token } = await seedOrgWithSessionToken("Onboarding Patch Org");
      const response = await app.inject({
        method: "PATCH",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
        payload: { gender: "MALE" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ gender: "MALE", style: null });
    });

    it("rejects an invalid enum value with 400", async () => {
      const { token } = await seedOrgWithSessionToken("Onboarding Invalid Org");
      const response = await app.inject({
        method: "PATCH",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
        payload: { gender: "ROBOT" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects a preview URL host that isn't allowlisted", async () => {
      const { token } = await seedOrgWithSessionToken("Onboarding Bad Host Org");
      const response = await app.inject({
        method: "PATCH",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
        payload: { avatarModelUrl: "https://evil.example.com/avatar.glb" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("accepts the 4 additive preview fields", async () => {
      const { token } = await seedOrgWithSessionToken("Onboarding Preview Org");
      const response = await app.inject({
        method: "PATCH",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
        payload: {
          previewProvider: "READY_PLAYER_ME",
          externalAvatarId: "rpm-123",
          avatarModelUrl: "https://models.readyplayer.me/abc.glb",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        previewProvider: "READY_PLAYER_ME",
        externalAvatarId: "rpm-123",
      });
    });

    it("accepts preferredLanguage: SPANISH", async () => {
      const { token } = await seedOrgWithSessionToken("Onboarding Spanish Language Org");
      const response = await app.inject({
        method: "PATCH",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
        payload: { preferredLanguage: "SPANISH" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ preferredLanguage: "SPANISH" });
    });
  });

  describe("POST /v1/onboarding/complete", () => {
    it("rejects an incomplete draft with 400 and names every missing field", async () => {
      const { token } = await seedOrgWithSessionToken("Onboarding Incomplete Org");
      const response = await app.inject({
        method: "POST",
        url: "/v1/onboarding/complete",
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe("incomplete_onboarding");
      expect(Array.isArray(body.fields)).toBe(true);
      expect(body.fields.length).toBeGreaterThan(0);
    });

    it("succeeds with only the required fields set, ignoring absent preview fields", async () => {
      const { token, userId } = await seedOrgWithSessionToken("Onboarding Complete Org");
      await app.inject({
        method: "PATCH",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
        payload: FULL_VALID_PATCH,
      });

      const response = await app.inject({
        method: "POST",
        url: "/v1/onboarding/complete",
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty("avatarId");

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.onboardingCompletedAt).not.toBeNull();
    });

    it("a second complete, and any further GET/PATCH, return 409 draft_already_completed", async () => {
      const { token } = await seedOrgWithSessionToken("Onboarding Twice Org");
      await app.inject({
        method: "PATCH",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
        payload: FULL_VALID_PATCH,
      });
      const first = await app.inject({
        method: "POST",
        url: "/v1/onboarding/complete",
        cookies: { avatrain_session: token },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: "POST",
        url: "/v1/onboarding/complete",
        cookies: { avatrain_session: token },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({ error: "draft_already_completed" });

      const getAfter = await app.inject({
        method: "GET",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
      });
      expect(getAfter.statusCode).toBe(409);

      const patchAfter = await app.inject({
        method: "PATCH",
        url: "/v1/onboarding",
        cookies: { avatrain_session: token },
        payload: { gender: "MALE" },
      });
      expect(patchAfter.statusCode).toBe(409);
    });
  });

  describe("two-org isolation", () => {
    it("org A's draft edits are never visible to org B's draft", async () => {
      const { token: tokenA } = await seedOrgWithSessionToken("Onboarding Org A");
      const { token: tokenB } = await seedOrgWithSessionToken("Onboarding Org B");

      const patchA = await app.inject({
        method: "PATCH",
        url: "/v1/onboarding",
        cookies: { avatrain_session: tokenA },
        payload: { name: "Org A Only Avatar", gender: "FEMALE" },
      });
      expect(patchA.statusCode).toBe(200);

      const getB = await app.inject({
        method: "GET",
        url: "/v1/onboarding",
        cookies: { avatrain_session: tokenB },
      });
      expect(getB.statusCode).toBe(200);
      expect(getB.json().name).toBeNull();
      expect(getB.json().gender).toBeNull();
    });
  });
});
