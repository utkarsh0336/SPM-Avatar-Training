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
      await tx.knowledgeAccessEvent.deleteMany({ where: { orgId } });
      await tx.knowledgeDocument.deleteMany({ where: { orgId } });
      await tx.message.deleteMany({ where: { orgId } });
      await tx.trainingSession.deleteMany({ where: { orgId } });
      // Objective/ObjectiveProgress cascade via curricula's FK ON DELETE CASCADE.
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

async function seedTrainingSession(orgId: string, userId: string) {
  return withAuthContext({ orgId, userId }, (tx) =>
    tx.trainingSession.create({
      data: {
        orgId,
        createdByUserId: userId,
        clientRequestId: randomUUID(),
        kind: "VOICE_ONLY",
        title: "Test Session",
        voiceExpertId: "priya",
        personaName: "Priya",
        personaRole: "HR Expert",
      },
    }),
  );
}

describe("GET /v1/analytics/usage", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/analytics/usage" });
    expect(response.statusCode).toBe(401);
  });

  it("403s for a MEMBER caller", async () => {
    const { token } = await seedOrgWithSessionToken("Analytics Member Org", "MEMBER");
    const response = await app.inject({
      method: "GET",
      url: "/v1/analytics/usage",
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(403);
  });

  it("403s for a PARTNER caller", async () => {
    const { token } = await seedOrgWithSessionToken("Analytics Partner Org", "PARTNER");
    const response = await app.inject({
      method: "GET",
      url: "/v1/analytics/usage",
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(403);
  });

  it("200s for OWNER with the expected shape", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Analytics Owner Org");
    await seedTrainingSession(orgId, userId);

    const response = await app.inject({
      method: "GET",
      url: "/v1/analytics/usage",
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      windowDays: 30,
      activeUserCount: 1,
      totalConversationCount: 1,
    });
  });

  it("400s on an invalid days value", async () => {
    const { token } = await seedOrgWithSessionToken("Analytics Invalid Days Org");
    const response = await app.inject({
      method: "GET",
      url: "/v1/analytics/usage?days=14",
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(400);
  });

  it("accepts days=7 and days=90", async () => {
    const { token } = await seedOrgWithSessionToken("Analytics Valid Days Org");
    const seven = await app.inject({
      method: "GET",
      url: "/v1/analytics/usage?days=7",
      cookies: { avatrain_session: token },
    });
    expect(seven.statusCode).toBe(200);
    expect(seven.json().windowDays).toBe(7);

    const ninety = await app.inject({
      method: "GET",
      url: "/v1/analytics/usage?days=90",
      cookies: { avatrain_session: token },
    });
    expect(ninety.statusCode).toBe(200);
    expect(ninety.json().windowDays).toBe(90);
  });

  it("never includes another org's sessions in the aggregate (two-org isolation)", async () => {
    const orgA = await seedOrgWithSessionToken("Analytics Isolation Org A");
    const orgB = await seedOrgWithSessionToken("Analytics Isolation Org B");
    await seedTrainingSession(orgB.orgId, orgB.userId);
    await seedTrainingSession(orgB.orgId, orgB.userId);

    const response = await app.inject({
      method: "GET",
      url: "/v1/analytics/usage",
      cookies: { avatrain_session: orgA.token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ activeUserCount: 0, totalConversationCount: 0, topKnowledgeAreas: [] });
  });
});

async function seedObjectiveProgress(orgId: string, userId: string, learnerId: string) {
  return withAuthContext({ orgId, userId }, async (tx) => {
    const avatar = await tx.avatar.create({ data: { orgId, createdById: userId, name: "Test Avatar" } });
    const curriculum = await tx.curriculum.create({
      data: { orgId, avatarId: avatar.id, createdById: userId, title: "Test Curriculum" },
    });
    const objective = await tx.objective.create({
      data: {
        orgId,
        curriculumId: curriculum.id,
        order: 0,
        title: "Test Objective",
        teachingContent: "T",
        checkQuestion: "Q",
        gradingCriteria: "G",
      },
    });
    await tx.objectiveProgress.create({
      data: { orgId, objectiveId: objective.id, learnerId, verdict: "PASS", attempts: 1, feedback: "Good" },
    });
  });
}

describe("GET /v1/analytics/training", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/analytics/training" });
    expect(response.statusCode).toBe(401);
  });

  it("403s for a MEMBER caller", async () => {
    const { token } = await seedOrgWithSessionToken("Training Analytics Member Org", "MEMBER");
    const response = await app.inject({
      method: "GET",
      url: "/v1/analytics/training",
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(403);
  });

  it("403s for a PARTNER caller", async () => {
    const { token } = await seedOrgWithSessionToken("Training Analytics Partner Org", "PARTNER");
    const response = await app.inject({
      method: "GET",
      url: "/v1/analytics/training",
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(403);
  });

  it("200s for OWNER with the expected shape on an org with no activity", async () => {
    const { token } = await seedOrgWithSessionToken("Training Analytics Owner Org");

    const response = await app.inject({
      method: "GET",
      url: "/v1/analytics/training",
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      participantCount: 0,
      curriculumsWithActivityCount: 0,
      avgCompletionRate: null,
      avgTimeToCompetencySeconds: null,
      knowledgeGaps: [],
    });
  });

  it("never includes another org's ObjectiveProgress in the aggregate (two-org isolation)", async () => {
    const orgA = await seedOrgWithSessionToken("Training Analytics Isolation Org A");
    const orgB = await seedOrgWithSessionToken("Training Analytics Isolation Org B");
    await seedObjectiveProgress(orgB.orgId, orgB.userId, orgB.userId);

    const response = await app.inject({
      method: "GET",
      url: "/v1/analytics/training",
      cookies: { avatrain_session: orgA.token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ participantCount: 0, curriculumsWithActivityCount: 0, knowledgeGaps: [] });
  });
});
