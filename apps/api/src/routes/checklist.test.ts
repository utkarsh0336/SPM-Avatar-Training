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
      // Cascades to induction_checklists -> checklist_items -> checklist_item_progress.
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

/** Adds a second user to an EXISTING org — mirrors curriculum.test.ts's own helper. */
async function seedTeammateSessionToken(orgId: string, role: Role = "MEMBER"): Promise<SeededOrg> {
  const userId = randomUUID();
  const token = generateOpaqueToken();
  const tokenHash = sha256Hex(token);

  await prisma.$transaction(async (tx) => {
    await tx.user.create({ data: { id: userId, email: uniqueEmail("teammate"), passwordHash: "seeded" } });
    await setAuthContext(tx, { userId, orgId });
    await tx.membership.create({ data: { orgId, userId, role } });
    await tx.session.create({
      data: { orgId, userId, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
  });

  createdUserIds.push(userId);
  return { token, userId, orgId };
}

async function seedCurriculumId(orgId: string, userId: string, ownerToken: string): Promise<string> {
  const avatar = await withAuthContext({ orgId, userId }, (tx) =>
    tx.avatar.create({ data: { orgId, createdById: userId, name: "Test Avatar" } }),
  );
  const create = await app.inject({
    method: "POST",
    url: "/v1/curricula",
    cookies: { avatrain_session: ownerToken },
    payload: { avatarId: avatar.id, title: "X" },
  });
  return create.json().id as string;
}

describe("checklist routes", () => {
  describe("POST /v1/curricula/:curriculumId/checklist", () => {
    it("requires authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/curricula/${randomUUID()}/checklist`,
        payload: { title: "Induction" },
      });
      expect(response.statusCode).toBe(401);
    });

    it("403s for a MEMBER caller", async () => {
      const { token } = await seedOrgWithSessionToken("Checklist Member Org", "MEMBER");
      const response = await app.inject({
        method: "POST",
        url: `/v1/curricula/${randomUUID()}/checklist`,
        cookies: { avatrain_session: token },
        payload: { title: "Induction" },
      });
      expect(response.statusCode).toBe(403);
    });

    it("201s for an OWNER, 409s on a second create for the same curriculum", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Checklist Create Org");
      const curriculumId = await seedCurriculumId(orgId, userId, token);

      const first = await app.inject({
        method: "POST",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: token },
        payload: { title: "Day One Induction" },
      });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({ curriculumId, title: "Day One Induction" });

      const second = await app.inject({
        method: "POST",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: token },
        payload: { title: "Second" },
      });
      expect(second.statusCode).toBe(409);
    });

    it("404s for a curriculum in another org", async () => {
      const orgA = await seedOrgWithSessionToken("Checklist Create Isolation Org A");
      const orgB = await seedOrgWithSessionToken("Checklist Create Isolation Org B");
      const curriculumId = await seedCurriculumId(orgA.orgId, orgA.userId, orgA.token);

      const response = await app.inject({
        method: "POST",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: orgB.token },
        payload: { title: "Hijacked" },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /v1/curricula/:curriculumId/checklist", () => {
    it("404s when no checklist exists yet", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Checklist Get Missing Org");
      const curriculumId = await seedCurriculumId(orgId, userId, token);

      const response = await app.inject({
        method: "GET",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(404);
    });

    it("a MEMBER (any authenticated org member) can read it", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Checklist Get Member Org");
      const member = await seedTeammateSessionToken(orgId, "MEMBER");
      const curriculumId = await seedCurriculumId(orgId, userId, token);
      await app.inject({
        method: "POST",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: token },
        payload: { title: "Induction" },
      });

      const response = await app.inject({
        method: "GET",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: member.token },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ curriculumId, title: "Induction", items: [] });
    });

    it("404s for another org's curriculum", async () => {
      const orgA = await seedOrgWithSessionToken("Checklist Get Isolation Org A");
      const orgB = await seedOrgWithSessionToken("Checklist Get Isolation Org B");
      const curriculumId = await seedCurriculumId(orgA.orgId, orgA.userId, orgA.token);
      await app.inject({
        method: "POST",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: orgA.token },
        payload: { title: "Induction" },
      });

      const response = await app.inject({
        method: "GET",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: orgB.token },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("PUT /v1/curricula/:curriculumId/checklist/items", () => {
    async function seedChecklistId(curriculumId: string, token: string): Promise<void> {
      await app.inject({
        method: "POST",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: token },
        payload: { title: "Induction" },
      });
    }

    it("403s for a MEMBER caller", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Checklist Put Member Org");
      const member = await seedTeammateSessionToken(orgId, "MEMBER");
      const curriculumId = await seedCurriculumId(orgId, userId, token);
      await seedChecklistId(curriculumId, token);

      const response = await app.inject({
        method: "PUT",
        url: `/v1/curricula/${curriculumId}/checklist/items`,
        cookies: { avatrain_session: member.token },
        payload: { items: [{ title: "X" }] },
      });
      expect(response.statusCode).toBe(403);
    });

    it("replaces the item list and GET reflects it", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Checklist Put Org");
      const curriculumId = await seedCurriculumId(orgId, userId, token);
      await seedChecklistId(curriculumId, token);

      const put = await app.inject({
        method: "PUT",
        url: `/v1/curricula/${curriculumId}/checklist/items`,
        cookies: { avatrain_session: token },
        payload: {
          items: [
            { title: "Read the handbook", description: "See the intranet" },
            { title: "Meet your manager" },
          ],
        },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().items).toHaveLength(2);
      expect(put.json().items[0]).toMatchObject({ title: "Read the handbook", description: "See the intranet", completed: false });
      expect(put.json().items[1]).toMatchObject({ title: "Meet your manager", description: null });

      const get = await app.inject({
        method: "GET",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: token },
      });
      expect(get.json().items).toHaveLength(2);
    });

    it("404s for another org's curriculum", async () => {
      const orgA = await seedOrgWithSessionToken("Checklist Put Isolation Org A");
      const orgB = await seedOrgWithSessionToken("Checklist Put Isolation Org B");
      const curriculumId = await seedCurriculumId(orgA.orgId, orgA.userId, orgA.token);
      await seedChecklistId(curriculumId, orgA.token);

      const response = await app.inject({
        method: "PUT",
        url: `/v1/curricula/${curriculumId}/checklist/items`,
        cookies: { avatrain_session: orgB.token },
        payload: { items: [{ title: "X" }] },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("DELETE /v1/curricula/:curriculumId/checklist", () => {
    it("removes the checklist, and a later GET 404s", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Checklist Delete Org");
      const curriculumId = await seedCurriculumId(orgId, userId, token);
      await app.inject({
        method: "POST",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: token },
        payload: { title: "Induction" },
      });

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: token },
      });
      expect(deleteResponse.statusCode).toBe(204);

      const getResponse = await app.inject({
        method: "GET",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: token },
      });
      expect(getResponse.statusCode).toBe(404);
    });
  });

  describe("PATCH /v1/checklist-items/:itemId/complete", () => {
    async function seedItemId(curriculumId: string, token: string): Promise<string> {
      await app.inject({
        method: "POST",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: token },
        payload: { title: "Induction" },
      });
      const put = await app.inject({
        method: "PUT",
        url: `/v1/curricula/${curriculumId}/checklist/items`,
        cookies: { avatrain_session: token },
        payload: { items: [{ title: "Read the handbook" }] },
      });
      return put.json().items[0].id as string;
    }

    it("requires authentication", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/v1/checklist-items/${randomUUID()}/complete`,
        payload: { completed: true },
      });
      expect(response.statusCode).toBe(401);
    });

    it("marks an item completed, then un-completes it", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Checklist Complete Org");
      const curriculumId = await seedCurriculumId(orgId, userId, token);
      const itemId = await seedItemId(curriculumId, token);

      const complete = await app.inject({
        method: "PATCH",
        url: `/v1/checklist-items/${itemId}/complete`,
        cookies: { avatrain_session: token },
        payload: { completed: true },
      });
      expect(complete.statusCode).toBe(200);
      expect(complete.json()).toMatchObject({ itemId, completed: true });
      expect(complete.json().completedAt).not.toBeNull();

      const uncomplete = await app.inject({
        method: "PATCH",
        url: `/v1/checklist-items/${itemId}/complete`,
        cookies: { avatrain_session: token },
        payload: { completed: false },
      });
      expect(uncomplete.statusCode).toBe(200);
      expect(uncomplete.json()).toMatchObject({ itemId, completed: false, completedAt: null });
    });

    it("completion is per-caller — one learner completing an item doesn't affect another's view", async () => {
      const { token, orgId, userId } = await seedOrgWithSessionToken("Checklist Per Learner Org");
      const learnerB = await seedTeammateSessionToken(orgId, "MEMBER");
      const curriculumId = await seedCurriculumId(orgId, userId, token);
      const itemId = await seedItemId(curriculumId, token);

      await app.inject({
        method: "PATCH",
        url: `/v1/checklist-items/${itemId}/complete`,
        cookies: { avatrain_session: token },
        payload: { completed: true },
      });

      const getForOwner = await app.inject({
        method: "GET",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: token },
      });
      expect(getForOwner.json().items[0].completed).toBe(true);

      const getForLearnerB = await app.inject({
        method: "GET",
        url: `/v1/curricula/${curriculumId}/checklist`,
        cookies: { avatrain_session: learnerB.token },
      });
      expect(getForLearnerB.json().items[0].completed).toBe(false);
    });

    it("404s for an item in another org", async () => {
      const orgA = await seedOrgWithSessionToken("Checklist Complete Isolation Org A");
      const orgB = await seedOrgWithSessionToken("Checklist Complete Isolation Org B");
      const curriculumId = await seedCurriculumId(orgA.orgId, orgA.userId, orgA.token);
      const itemId = await seedItemId(curriculumId, orgA.token);

      const response = await app.inject({
        method: "PATCH",
        url: `/v1/checklist-items/${itemId}/complete`,
        cookies: { avatrain_session: orgB.token },
        payload: { completed: true },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
