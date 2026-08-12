import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { generateOpaqueToken, prisma, setAuthContext, sha256Hex, withAuthContext, type Role } from "@avatrain/shared";
import { buildApp } from "../app.js";

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.com`;
}

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const orgId of createdOrgIds) {
    await withAuthContext({ orgId }, async (tx) => {
      await tx.curriculum.deleteMany({ where: { orgId } });
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

interface SeededOrg {
  token: string;
  userId: string;
  orgId: string;
}

async function seedOrgWithSessionToken(orgName: string, role: Role = "OWNER"): Promise<SeededOrg> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const token = generateOpaqueToken();
  const tokenHash = sha256Hex(token);

  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: orgName } });
    await tx.user.create({ data: { id: userId, email: uniqueEmail(orgName), passwordHash: "seeded" } });
    await setAuthContext(tx, { userId, orgId });
    await tx.membership.create({ data: { orgId, userId, role } });
    await tx.session.create({
      data: { orgId, userId, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
  });

  createdOrgIds.push(orgId);
  createdUserIds.push(userId);
  return { token, userId, orgId };
}

async function seedAvatar(orgId: string, userId: string): Promise<string> {
  const avatar = await withAuthContext({ orgId, userId }, (tx) =>
    tx.avatar.create({ data: { orgId, createdById: userId, name: "Test Avatar" } }),
  );
  return avatar.id;
}

describe("curriculum routes", () => {
  describe("POST /v1/curricula", () => {
    it("requires authentication", async () => {
      const response = await app.inject({ method: "POST", url: "/v1/curricula", payload: { avatarId: randomUUID(), title: "X" } });
      expect(response.statusCode).toBe(401);
    });

    it("403s for a MEMBER caller", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Curriculum Member Org", "MEMBER");
      const avatarId = await seedAvatar(orgId, userId);
      const response = await app.inject({
        method: "POST",
        url: "/v1/curricula",
        cookies: { avatrain_session: token },
        payload: { avatarId, title: "X" },
      });
      expect(response.statusCode).toBe(403);
    });

    it("201s for an OWNER", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Curriculum Create Org");
      const avatarId = await seedAvatar(orgId, userId);
      const response = await app.inject({
        method: "POST",
        url: "/v1/curricula",
        cookies: { avatrain_session: token },
        payload: { avatarId, title: "Onboarding" },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ avatarId, title: "Onboarding" });
    });

    it("409s when the avatar already has a curriculum", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Curriculum Duplicate Org");
      const avatarId = await seedAvatar(orgId, userId);
      await app.inject({
        method: "POST",
        url: "/v1/curricula",
        cookies: { avatrain_session: token },
        payload: { avatarId, title: "First" },
      });
      const response = await app.inject({
        method: "POST",
        url: "/v1/curricula",
        cookies: { avatrain_session: token },
        payload: { avatarId, title: "Second" },
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe("GET/PUT/DELETE /v1/curricula/:curriculumId", () => {
    it("GET 404s for a curriculum that does not exist", async () => {
      const { token } = await seedOrgWithSessionToken("Curriculum Get Missing Org");
      const response = await app.inject({
        method: "GET",
        url: `/v1/curricula/${randomUUID()}`,
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(404);
    });

    it("PUT replaces the objective list and GET reflects it", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Curriculum Put Org");
      const avatarId = await seedAvatar(orgId, userId);
      const create = await app.inject({
        method: "POST",
        url: "/v1/curricula",
        cookies: { avatrain_session: token },
        payload: { avatarId, title: "X" },
      });
      const { id: curriculumId } = create.json();

      const put = await app.inject({
        method: "PUT",
        url: `/v1/curricula/${curriculumId}/objectives`,
        cookies: { avatrain_session: token },
        payload: {
          objectives: [
            { title: "First", teachingContent: "T1", checkQuestion: "Q1", gradingCriteria: "G1" },
            { title: "Second", teachingContent: "T2", checkQuestion: "Q2", gradingCriteria: "G2" },
          ],
        },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().objectives).toHaveLength(2);

      const get = await app.inject({
        method: "GET",
        url: `/v1/curricula/${curriculumId}`,
        cookies: { avatrain_session: token },
      });
      expect(get.json().objectives).toHaveLength(2);
      expect(get.json().objectives[0].title).toBe("First");
    });

    it("DELETE removes the curriculum, and a later GET 404s", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Curriculum Delete Org");
      const avatarId = await seedAvatar(orgId, userId);
      const create = await app.inject({
        method: "POST",
        url: "/v1/curricula",
        cookies: { avatrain_session: token },
        payload: { avatarId, title: "X" },
      });
      const { id: curriculumId } = create.json();

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/v1/curricula/${curriculumId}`,
        cookies: { avatrain_session: token },
      });
      expect(deleteResponse.statusCode).toBe(204);

      const getResponse = await app.inject({
        method: "GET",
        url: `/v1/curricula/${curriculumId}`,
        cookies: { avatrain_session: token },
      });
      expect(getResponse.statusCode).toBe(404);
    });

    describe("two-org isolation", () => {
      it("org B gets 404 (not org A's curriculum) for GET, PUT, and DELETE", async () => {
        const orgA = await seedOrgWithSessionToken("Curriculum Isolation Org A");
        const orgB = await seedOrgWithSessionToken("Curriculum Isolation Org B");
        const avatarId = await seedAvatar(orgA.orgId, orgA.userId);

        const create = await app.inject({
          method: "POST",
          url: "/v1/curricula",
          cookies: { avatrain_session: orgA.token },
          payload: { avatarId, title: "Secret" },
        });
        const { id: curriculumId } = create.json();

        const getResponse = await app.inject({
          method: "GET",
          url: `/v1/curricula/${curriculumId}`,
          cookies: { avatrain_session: orgB.token },
        });
        expect(getResponse.statusCode).toBe(404);

        const putResponse = await app.inject({
          method: "PUT",
          url: `/v1/curricula/${curriculumId}/objectives`,
          cookies: { avatrain_session: orgB.token },
          payload: { objectives: [{ title: "X", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" }] },
        });
        expect(putResponse.statusCode).toBe(404);

        const deleteResponse = await app.inject({
          method: "DELETE",
          url: `/v1/curricula/${curriculumId}`,
          cookies: { avatrain_session: orgB.token },
        });
        expect(deleteResponse.statusCode).toBe(404);

        const stillThere = await app.inject({
          method: "GET",
          url: `/v1/curricula/${curriculumId}`,
          cookies: { avatrain_session: orgA.token },
        });
        expect(stillThere.statusCode).toBe(200);
      });
    });
  });

  describe("GET /v1/curricula/:curriculumId/progress", () => {
    it("returns an empty list when nothing has been graded yet", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Curriculum Progress Org");
      const avatarId = await seedAvatar(orgId, userId);
      const create = await app.inject({
        method: "POST",
        url: "/v1/curricula",
        cookies: { avatrain_session: token },
        payload: { avatarId, title: "X" },
      });
      const { id: curriculumId } = create.json();

      const response = await app.inject({
        method: "GET",
        url: `/v1/curricula/${curriculumId}/progress`,
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().progress).toEqual([]);
    });

    it("404s for another org's curriculum", async () => {
      const orgA = await seedOrgWithSessionToken("Curriculum Progress Isolation Org A");
      const orgB = await seedOrgWithSessionToken("Curriculum Progress Isolation Org B");
      const avatarId = await seedAvatar(orgA.orgId, orgA.userId);
      const create = await app.inject({
        method: "POST",
        url: "/v1/curricula",
        cookies: { avatrain_session: orgA.token },
        payload: { avatarId, title: "X" },
      });
      const { id: curriculumId } = create.json();

      const response = await app.inject({
        method: "GET",
        url: `/v1/curricula/${curriculumId}/progress`,
        cookies: { avatrain_session: orgB.token },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
