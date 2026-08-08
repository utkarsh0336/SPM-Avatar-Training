import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, setAuthContext, withAuthContext } from "@avatrain/shared";
import { getCallerSimliFaceId, updateDraft } from "./onboarding-service.js";

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const orgId of createdOrgIds) {
    await withAuthContext({ orgId }, async (tx) => {
      await tx.avatar.deleteMany({ where: { orgId } });
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

async function seedOrgAndUser(): Promise<{ orgId: string; userId: string }> {
  const orgId = randomUUID();
  const userId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: "Face Lookup Org" } });
    await tx.user.create({
      data: { id: userId, email: `face-lookup-${randomUUID()}@example.com`, passwordHash: "seeded" },
    });
    await setAuthContext(tx, { userId, orgId });
    await tx.membership.create({ data: { orgId, userId, role: "OWNER" } });
  });
  createdOrgIds.push(orgId);
  createdUserIds.push(userId);
  return { orgId, userId };
}

describe("getCallerSimliFaceId", () => {
  it("returns null when the caller has no avatar at all", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    expect(await getCallerSimliFaceId(orgId, userId)).toBeNull();
  });

  it("returns a DRAFT avatar's face when no ACTIVE avatar exists yet", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    await withAuthContext({ orgId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, simliFaceId: "face-draft" } }),
    );
    expect(await getCallerSimliFaceId(orgId, userId)).toBe("face-draft");
  });

  it("prefers the ACTIVE avatar's face over a DRAFT's — same person, one true current face", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    await withAuthContext({ orgId }, async (tx) => {
      await tx.avatar.create({
        data: { orgId, createdById: userId, status: "ACTIVE", simliFaceId: "face-active" },
      });
      await tx.avatar.create({
        data: { orgId, createdById: userId, status: "DRAFT", simliFaceId: "face-draft" },
      });
    });
    expect(await getCallerSimliFaceId(orgId, userId)).toBe("face-active");
  });

  it("returns null when the resolved avatar has no simliFaceId set", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    await withAuthContext({ orgId }, (tx) => tx.avatar.create({ data: { orgId, createdById: userId } }));
    expect(await getCallerSimliFaceId(orgId, userId)).toBeNull();
  });
});

describe("updateDraft — simliFaceId recomputation", () => {
  it("recomputes simliFaceId whenever gender is part of the patch", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    await withAuthContext({ orgId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, simliFaceId: "stale-sentinel-face" } }),
    );

    const result = await updateDraft(orgId, userId, { gender: "MALE" });

    // Simli isn't configured in this test process's env — resolveSimliFaceId
    // (unit-tested directly with injected env in lib/simli.test.ts) returns
    // null in that case. The point here is that the stale sentinel value was
    // actually overwritten by the recompute, proving updateDraft's wiring
    // runs, not asserting the specific env-dependent resolution outcome.
    expect(result.simliFaceId).not.toBe("stale-sentinel-face");
  });

  it("leaves simliFaceId untouched when the patch doesn't include gender", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    await withAuthContext({ orgId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, simliFaceId: "kept-face" } }),
    );

    const result = await updateDraft(orgId, userId, { outfit: "BUSINESS_CASUAL" });

    expect(result.simliFaceId).toBe("kept-face");
  });
});
