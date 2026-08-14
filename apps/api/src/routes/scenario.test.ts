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

async function seedObjective(token: string, orgId: string, userId: string): Promise<string> {
  const avatar = await withAuthContext({ orgId, userId }, (tx) =>
    tx.avatar.create({ data: { orgId, createdById: userId, name: "Test Avatar" } }),
  );
  const create = await app.inject({
    method: "POST",
    url: "/v1/curricula",
    cookies: { avatrain_session: token },
    payload: { avatarId: avatar.id, title: "X" },
  });
  const { id: curriculumId } = create.json();
  const put = await app.inject({
    method: "PUT",
    url: `/v1/curricula/${curriculumId}/objectives`,
    cookies: { avatrain_session: token },
    payload: { objectives: [{ title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" }] },
  });
  return put.json().objectives[0].id as string;
}

const validSteps = [
  { order: 0, prompt: "P", branches: [{ order: 0, matchCriteria: "M", nextStepOrder: null, outcome: "PASS" }] },
];

describe("scenario routes", () => {
  describe("PUT /v1/objectives/:objectiveId/scenario", () => {
    it("requires authentication", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/v1/objectives/${randomUUID()}/scenario`,
        payload: { steps: validSteps },
      });
      expect(response.statusCode).toBe(401);
    });

    it("403s a non-OWNER caller", async () => {
      const owner = await seedOrgWithSessionToken("Scenario Route Write Org");
      const member = await seedTeammateSessionToken(owner.orgId, "MEMBER");
      const objectiveId = await seedObjective(owner.token, owner.orgId, owner.userId);

      const response = await app.inject({
        method: "PUT",
        url: `/v1/objectives/${objectiveId}/scenario`,
        cookies: { avatrain_session: member.token },
        payload: { steps: validSteps },
      });
      expect(response.statusCode).toBe(403);
    });

    it("saves a scenario and returns it with real ids", async () => {
      const owner = await seedOrgWithSessionToken("Scenario Route Save Org");
      const objectiveId = await seedObjective(owner.token, owner.orgId, owner.userId);

      const response = await app.inject({
        method: "PUT",
        url: `/v1/objectives/${objectiveId}/scenario`,
        cookies: { avatrain_session: owner.token },
        payload: { steps: validSteps },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().steps).toHaveLength(1);
      expect(response.json().steps[0]).toMatchObject({ prompt: "P" });
    });

    it("400s on an invalid scenario (dangling nextStepOrder)", async () => {
      const owner = await seedOrgWithSessionToken("Scenario Route Invalid Org");
      const objectiveId = await seedObjective(owner.token, owner.orgId, owner.userId);

      const response = await app.inject({
        method: "PUT",
        url: `/v1/objectives/${objectiveId}/scenario`,
        cookies: { avatrain_session: owner.token },
        payload: {
          steps: [{ order: 0, prompt: "P", branches: [{ order: 0, matchCriteria: "M", nextStepOrder: 9, outcome: null }] }],
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it("two-org isolation: org B gets 404 for org A's objective, org A's scenario is unaffected", async () => {
      const orgA = await seedOrgWithSessionToken("Scenario Isolation Org A");
      const orgB = await seedOrgWithSessionToken("Scenario Isolation Org B");
      const objectiveId = await seedObjective(orgA.token, orgA.orgId, orgA.userId);

      const crossOrgResponse = await app.inject({
        method: "PUT",
        url: `/v1/objectives/${objectiveId}/scenario`,
        cookies: { avatrain_session: orgB.token },
        payload: { steps: validSteps },
      });
      expect(crossOrgResponse.statusCode).toBe(404);

      const ownOrgResponse = await app.inject({
        method: "PUT",
        url: `/v1/objectives/${objectiveId}/scenario`,
        cookies: { avatrain_session: orgA.token },
        payload: { steps: validSteps },
      });
      expect(ownOrgResponse.statusCode).toBe(200);
    });
  });
});
