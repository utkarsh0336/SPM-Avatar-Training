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

async function seedOrgWithSessionToken(orgName: string, role: Role = "OWNER") {
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

describe("GET /v1/avatars", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/avatars" });
    expect(response.statusCode).toBe(401);
  });

  it("403s for a MEMBER caller", async () => {
    const { token } = await seedOrgWithSessionToken("Avatars Member Org", "MEMBER");
    const response = await app.inject({ method: "GET", url: "/v1/avatars", cookies: { avatrain_session: token } });
    expect(response.statusCode).toBe(403);
  });

  it("lists only ACTIVE avatars for the caller's org, excluding DRAFT and other orgs' avatars", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars List Org");
    const otherOrg = await seedOrgWithSessionToken("Avatars Other Org");

    await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "Active Avatar", status: "ACTIVE" } }),
    );
    await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "Draft Avatar", status: "DRAFT" } }),
    );
    await withAuthContext({ orgId: otherOrg.orgId, userId: otherOrg.userId }, (tx) =>
      tx.avatar.create({
        data: { orgId: otherOrg.orgId, createdById: otherOrg.userId, name: "Other Org Avatar", status: "ACTIVE" },
      }),
    );

    const response = await app.inject({ method: "GET", url: "/v1/avatars", cookies: { avatrain_session: token } });
    expect(response.statusCode).toBe(200);
    expect(response.json().avatars).toEqual([{ id: expect.any(String), name: "Active Avatar", curriculumId: null }]);
  });

  it("reports the curriculumId for an avatar that already has one", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars With Curriculum Org");
    const avatar = await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "Curriculum Avatar", status: "ACTIVE" } }),
    );
    const curriculum = await withAuthContext({ orgId, userId }, (tx) =>
      tx.curriculum.create({ data: { orgId, avatarId: avatar.id, createdById: userId, title: "Onboarding" } }),
    );

    const response = await app.inject({ method: "GET", url: "/v1/avatars", cookies: { avatrain_session: token } });
    expect(response.json().avatars).toEqual([
      { id: avatar.id, name: "Curriculum Avatar", curriculumId: curriculum.id },
    ]);
  });
});
