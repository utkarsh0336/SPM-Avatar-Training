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

/**
 * Adds a second user to an EXISTING org — seedOrgWithSessionToken always
 * creates a brand-new org, so it can't be reused to seed "a teammate in the
 * same org" (two calls with the same orgName still create two distinct
 * orgs that merely share a display name).
 */
async function seedTeammateSessionToken(orgId: string, role: Role = "MEMBER") {
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
    expect(response.json().avatars).toEqual([
      { id: expect.any(String), name: "Active Avatar", curriculumId: null, programType: null },
    ]);
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
      { id: avatar.id, name: "Curriculum Avatar", curriculumId: curriculum.id, programType: null },
    ]);
  });
});

describe("GET /v1/avatars/mine", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/avatars/mine" });
    expect(response.statusCode).toBe(401);
  });

  it("does not require OWNER — a MEMBER can list their own avatars", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars Mine Member Org", "MEMBER");
    await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "My Avatar", status: "ACTIVE" } }),
    );

    const response = await app.inject({ method: "GET", url: "/v1/avatars/mine", cookies: { avatrain_session: token } });
    expect(response.statusCode).toBe(200);
    expect(response.json().avatars).toHaveLength(1);
  });

  it("returns the caller's ACTIVE avatar before their leftover DRAFT", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars Mine Order Org");
    await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "Old Draft", status: "DRAFT" } }),
    );
    await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "Published", status: "ACTIVE" } }),
    );

    const response = await app.inject({ method: "GET", url: "/v1/avatars/mine", cookies: { avatrain_session: token } });
    const names = response.json().avatars.map((avatar: { name: string }) => avatar.name);
    expect(names).toEqual(["Published", "Old Draft"]);
  });

  it("two-org isolation: never returns another org's avatars, and never a same-org teammate's avatars either", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars Mine Isolation Org");
    const otherOrg = await seedOrgWithSessionToken("Avatars Mine Isolation Other Org");
    const teammate = await seedTeammateSessionToken(orgId, "MEMBER");

    await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "Mine", status: "ACTIVE" } }),
    );
    await withAuthContext({ orgId: otherOrg.orgId, userId: otherOrg.userId }, (tx) =>
      tx.avatar.create({ data: { orgId: otherOrg.orgId, createdById: otherOrg.userId, name: "Other Org", status: "ACTIVE" } }),
    );

    const response = await app.inject({ method: "GET", url: "/v1/avatars/mine", cookies: { avatrain_session: token } });
    expect(response.json().avatars).toEqual([expect.objectContaining({ name: "Mine" })]);

    // Same org, but /mine is scoped to createdById — a teammate who hasn't
    // created their own avatar sees none, even though "Mine" is in their org.
    const teammateResponse = await app.inject({
      method: "GET",
      url: "/v1/avatars/mine",
      cookies: { avatrain_session: teammate.token },
    });
    expect(teammateResponse.json().avatars).toEqual([]);
  });
});

describe("GET /v1/avatars/:avatarId", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: `/v1/avatars/${randomUUID()}` });
    expect(response.statusCode).toBe(401);
  });

  it("404s for an id that doesn't exist", async () => {
    const { token } = await seedOrgWithSessionToken("Avatars ById Missing Org");
    const response = await app.inject({
      method: "GET",
      url: `/v1/avatars/${randomUUID()}`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(404);
  });

  it("400s for a non-uuid id", async () => {
    const { token } = await seedOrgWithSessionToken("Avatars ById Invalid Org");
    const response = await app.inject({
      method: "GET",
      url: "/v1/avatars/not-a-uuid",
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(400);
  });

  it("lets any org member read an avatar they didn't create themselves", async () => {
    const { orgId, userId } = await seedOrgWithSessionToken("Avatars ById Shared Org");
    const teammate = await seedTeammateSessionToken(orgId, "MEMBER");
    const avatar = await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({
        data: { orgId, createdById: userId, name: "Shared Persona", status: "ACTIVE", gender: "FEMALE", voice: "WARM" },
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: `/v1/avatars/${avatar.id}`,
      cookies: { avatrain_session: teammate.token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().avatar).toEqual(
      expect.objectContaining({ id: avatar.id, name: "Shared Persona", gender: "FEMALE", voice: "WARM" }),
    );
  });

  it("two-org isolation: 404s (not 200 with another org's data) for an avatar belonging to a different org", async () => {
    const { token } = await seedOrgWithSessionToken("Avatars ById Isolation Org");
    const otherOrg = await seedOrgWithSessionToken("Avatars ById Isolation Other Org");
    const otherAvatar = await withAuthContext({ orgId: otherOrg.orgId, userId: otherOrg.userId }, (tx) =>
      tx.avatar.create({ data: { orgId: otherOrg.orgId, createdById: otherOrg.userId, name: "Not Yours", status: "ACTIVE" } }),
    );

    const response = await app.inject({
      method: "GET",
      url: `/v1/avatars/${otherAvatar.id}`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /v1/avatars/mine excludes ARCHIVED avatars", () => {
  it("never returns an ARCHIVED avatar as a session's persona candidate", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars Mine Archived Org");
    await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "Archived", status: "ARCHIVED" } }),
    );

    const response = await app.inject({ method: "GET", url: "/v1/avatars/mine", cookies: { avatrain_session: token } });
    expect(response.json().avatars).toEqual([]);
  });
});

describe("GET /v1/avatars/all", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/avatars/all" });
    expect(response.statusCode).toBe(401);
  });

  it("403s for a MEMBER caller", async () => {
    const { token } = await seedOrgWithSessionToken("Avatars All Member Org", "MEMBER");
    const response = await app.inject({ method: "GET", url: "/v1/avatars/all", cookies: { avatrain_session: token } });
    expect(response.statusCode).toBe(403);
  });

  it("lists every status, unlike GET /v1/avatars (ACTIVE-only) or /mine (excludes ARCHIVED)", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars All Statuses Org");
    await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "A", status: "ACTIVE" } }),
    );
    await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "D", status: "DRAFT" } }),
    );
    await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "X", status: "ARCHIVED" } }),
    );

    const response = await app.inject({ method: "GET", url: "/v1/avatars/all", cookies: { avatrain_session: token } });
    const names = response.json().avatars.map((avatar: { name: string }) => avatar.name).sort();
    expect(names).toEqual(["A", "D", "X"]);
  });

  it("two-org isolation: never returns another org's avatars", async () => {
    const { token } = await seedOrgWithSessionToken("Avatars All Isolation Org");
    const otherOrg = await seedOrgWithSessionToken("Avatars All Isolation Other Org");
    await withAuthContext({ orgId: otherOrg.orgId, userId: otherOrg.userId }, (tx) =>
      tx.avatar.create({ data: { orgId: otherOrg.orgId, createdById: otherOrg.userId, name: "Not Yours", status: "ACTIVE" } }),
    );

    const response = await app.inject({ method: "GET", url: "/v1/avatars/all", cookies: { avatrain_session: token } });
    expect(response.json().avatars).toEqual([]);
  });
});

describe("POST /v1/avatars", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/avatars" });
    expect(response.statusCode).toBe(401);
  });

  it("403s for a MEMBER caller", async () => {
    const { token } = await seedOrgWithSessionToken("Avatars Create Member Org", "MEMBER");
    const response = await app.inject({ method: "POST", url: "/v1/avatars", cookies: { avatrain_session: token } });
    expect(response.statusCode).toBe(403);
  });

  it("creates a blank DRAFT persona, not gated by onboarding's one-time-completion check", async () => {
    const { token, userId, orgId } = await seedOrgWithSessionToken("Avatars Create Org");
    // Simulate this user having already completed onboarding once — POST
    // /v1/avatars must still work; it's a distinct, ungated CRUD surface.
    await prisma.user.update({ where: { id: userId }, data: { onboardingCompletedAt: new Date() } });

    const response = await app.inject({
      method: "POST",
      url: "/v1/avatars",
      cookies: { avatrain_session: token },
      payload: { name: "Sales Coach" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().avatar).toEqual(expect.objectContaining({ name: "Sales Coach", status: "DRAFT" }));

    const stored = await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.findUnique({ where: { id: response.json().avatar.id } }),
    );
    expect(stored?.orgId).toBe(orgId);
  });

  it("works with no body at all", async () => {
    const { token } = await seedOrgWithSessionToken("Avatars Create No Body Org");
    const response = await app.inject({ method: "POST", url: "/v1/avatars", cookies: { avatrain_session: token } });
    expect(response.statusCode).toBe(201);
    expect(response.json().avatar.name).toBeNull();
  });

  it("409s once the org hits MAX_AVATARS_PER_ORG", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars Create Cap Org");
    await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({ orgId, createdById: userId, name: `Persona ${i}`, status: "DRAFT" as const })),
      }),
    );

    const response = await app.inject({ method: "POST", url: "/v1/avatars", cookies: { avatrain_session: token } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("avatar_limit_reached");
  });
});

describe("PATCH /v1/avatars/:avatarId", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "PATCH", url: `/v1/avatars/${randomUUID()}`, payload: {} });
    expect(response.statusCode).toBe(401);
  });

  it("403s for a MEMBER caller", async () => {
    const { token } = await seedOrgWithSessionToken("Avatars Patch Member Org", "MEMBER");
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/avatars/${randomUUID()}`,
      cookies: { avatrain_session: token },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it("404s for an id that doesn't exist", async () => {
    const { token } = await seedOrgWithSessionToken("Avatars Patch Missing Org");
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/avatars/${randomUUID()}`,
      cookies: { avatrain_session: token },
      payload: { name: "New Name" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("updates fields and recomputes simliFaceId on a gender change", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars Patch Org");
    const avatar = await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "Draft", status: "DRAFT" } }),
    );

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/avatars/${avatar.id}`,
      cookies: { avatrain_session: token },
      payload: { name: "Renamed", gender: "MALE" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().avatar.name).toBe("Renamed");
    expect(response.json().avatar.gender).toBe("MALE");
  });

  it("round-trips readingLevel through PATCH and GET", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars Reading Level Org");
    const avatar = await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "Draft", status: "DRAFT" } }),
    );

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/v1/avatars/${avatar.id}`,
      cookies: { avatrain_session: token },
      payload: { readingLevel: "SIMPLE" },
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().avatar.readingLevel).toBe("SIMPLE");

    const getResponse = await app.inject({
      method: "GET",
      url: `/v1/avatars/${avatar.id}`,
      cookies: { avatrain_session: token },
    });
    expect(getResponse.json().avatar.readingLevel).toBe("SIMPLE");
  });

  it("two-org isolation: 404s (not a cross-tenant write) for another org's avatar", async () => {
    const { token } = await seedOrgWithSessionToken("Avatars Patch Isolation Org");
    const otherOrg = await seedOrgWithSessionToken("Avatars Patch Isolation Other Org");
    const otherAvatar = await withAuthContext({ orgId: otherOrg.orgId, userId: otherOrg.userId }, (tx) =>
      tx.avatar.create({ data: { orgId: otherOrg.orgId, createdById: otherOrg.userId, name: "Not Yours", status: "DRAFT" } }),
    );

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/avatars/${otherAvatar.id}`,
      cookies: { avatrain_session: token },
      payload: { name: "Hijacked" },
    });
    expect(response.statusCode).toBe(404);

    const stillOriginal = await withAuthContext({ orgId: otherOrg.orgId, userId: otherOrg.userId }, (tx) =>
      tx.avatar.findUnique({ where: { id: otherAvatar.id } }),
    );
    expect(stillOriginal?.name).toBe("Not Yours");
  });
});

const COMPLETE_PATCH = {
  name: "Complete Persona",
  style: "REALISTIC",
  gender: "FEMALE",
  skinTone: "TONE_2",
  hairStyle: "MEDIUM",
  hairColor: "AUBURN",
  outfit: "BUSINESS_FORMAL",
  expertise: "HR_LEAVE_POLICY",
  voice: "NEUTRAL",
} as const;

describe("POST /v1/avatars/:avatarId/publish", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "POST", url: `/v1/avatars/${randomUUID()}/publish` });
    expect(response.statusCode).toBe(401);
  });

  it("400s with the missing fields when the avatar is incomplete", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars Publish Incomplete Org");
    const avatar = await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "Half Done", status: "DRAFT" } }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/v1/avatars/${avatar.id}/publish`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("incomplete_avatar");
    expect(response.json().fields.length).toBeGreaterThan(0);
  });

  it("publishes a fully-populated draft to ACTIVE", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars Publish Org");
    const avatar = await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, status: "DRAFT", ...COMPLETE_PATCH } }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/v1/avatars/${avatar.id}/publish`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().avatar.status).toBe("ACTIVE");
  });

  it("restores an ARCHIVED avatar back to ACTIVE if it's still complete", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars Publish Restore Org");
    const avatar = await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, status: "ARCHIVED", ...COMPLETE_PATCH } }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/v1/avatars/${avatar.id}/publish`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().avatar.status).toBe("ACTIVE");
  });
});

describe("POST /v1/avatars/:avatarId/archive", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "POST", url: `/v1/avatars/${randomUUID()}/archive` });
    expect(response.statusCode).toBe(401);
  });

  it("archives an ACTIVE avatar without deleting it or its curriculum", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars Archive Org");
    const avatar = await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, status: "ACTIVE", ...COMPLETE_PATCH } }),
    );
    const curriculum = await withAuthContext({ orgId, userId }, (tx) =>
      tx.curriculum.create({ data: { orgId, avatarId: avatar.id, createdById: userId, title: "Onboarding" } }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/v1/avatars/${avatar.id}/archive`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().avatar.status).toBe("ARCHIVED");

    const curriculumStillExists = await withAuthContext({ orgId, userId }, (tx) =>
      tx.curriculum.findUnique({ where: { id: curriculum.id } }),
    );
    expect(curriculumStillExists).not.toBeNull();
  });

  it("archiving removes an avatar from /mine but it still appears in /all", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Avatars Archive Visibility Org");
    const avatar = await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, status: "ACTIVE", ...COMPLETE_PATCH } }),
    );
    await app.inject({ method: "POST", url: `/v1/avatars/${avatar.id}/archive`, cookies: { avatrain_session: token } });

    const mine = await app.inject({ method: "GET", url: "/v1/avatars/mine", cookies: { avatrain_session: token } });
    expect(mine.json().avatars).toEqual([]);

    const all = await app.inject({ method: "GET", url: "/v1/avatars/all", cookies: { avatrain_session: token } });
    expect(all.json().avatars).toEqual([expect.objectContaining({ id: avatar.id, status: "ARCHIVED" })]);
  });

  it("two-org isolation: 404s for another org's avatar", async () => {
    const { token } = await seedOrgWithSessionToken("Avatars Archive Isolation Org");
    const otherOrg = await seedOrgWithSessionToken("Avatars Archive Isolation Other Org");
    const otherAvatar = await withAuthContext({ orgId: otherOrg.orgId, userId: otherOrg.userId }, (tx) =>
      tx.avatar.create({ data: { orgId: otherOrg.orgId, createdById: otherOrg.userId, status: "ACTIVE", ...COMPLETE_PATCH } }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/v1/avatars/${otherAvatar.id}/archive`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(404);
  });
});
