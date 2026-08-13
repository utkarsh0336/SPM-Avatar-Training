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
      await tx.application.deleteMany({ where: { orgId } });
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

describe("GET /v1/applications", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/applications" });
    expect(response.statusCode).toBe(401);
  });

  it("403s for a MEMBER caller", async () => {
    const { token } = await seedOrgWithSessionToken("Applications Member Org", "MEMBER");
    const response = await app.inject({ method: "GET", url: "/v1/applications", cookies: { avatrain_session: token } });
    expect(response.statusCode).toBe(403);
  });

  it("two-org isolation: never returns another org's applications", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Applications List Org");
    const otherOrg = await seedOrgWithSessionToken("Applications Other Org");
    await withAuthContext({ orgId, userId }, (tx) =>
      tx.application.create({ data: { orgId, name: "Mine", publishableKey: `pk_${randomUUID()}` } }),
    );
    await withAuthContext({ orgId: otherOrg.orgId, userId: otherOrg.userId }, (tx) =>
      tx.application.create({ data: { orgId: otherOrg.orgId, name: "Not Yours", publishableKey: `pk_${randomUUID()}` } }),
    );

    const response = await app.inject({ method: "GET", url: "/v1/applications", cookies: { avatrain_session: token } });
    expect(response.json().applications).toEqual([expect.objectContaining({ name: "Mine" })]);
  });
});

describe("POST /v1/applications", () => {
  it("requires authentication", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/applications", payload: { name: "Widget" } });
    expect(response.statusCode).toBe(401);
  });

  it("403s for a MEMBER caller", async () => {
    const { token } = await seedOrgWithSessionToken("Applications Create Member Org", "MEMBER");
    const response = await app.inject({
      method: "POST",
      url: "/v1/applications",
      cookies: { avatrain_session: token },
      payload: { name: "Widget" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("creates an application with a fresh publishableKey, no allowed origins, and disabled-by-default is false (enabled)", async () => {
    const { token } = await seedOrgWithSessionToken("Applications Create Org");
    const response = await app.inject({
      method: "POST",
      url: "/v1/applications",
      cookies: { avatrain_session: token },
      payload: { name: "Marketing Site" },
    });
    expect(response.statusCode).toBe(201);
    const { application } = response.json();
    expect(application.name).toBe("Marketing Site");
    expect(application.publishableKey).toMatch(/^pk_/);
    expect(application.allowedOrigins).toEqual([]);
    expect(application.avatarId).toBeNull();
    expect(application.isEnabled).toBe(true);
  });

  it("400s for an empty name", async () => {
    const { token } = await seedOrgWithSessionToken("Applications Create Invalid Org");
    const response = await app.inject({
      method: "POST",
      url: "/v1/applications",
      cookies: { avatrain_session: token },
      payload: { name: "" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("PATCH /v1/applications/:applicationId", () => {
  it("404s for an id that doesn't exist", async () => {
    const { token } = await seedOrgWithSessionToken("Applications Patch Missing Org");
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/applications/${randomUUID()}`,
      cookies: { avatrain_session: token },
      payload: { name: "New Name" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("updates allowedOrigins, avatarId, and isEnabled", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Applications Patch Org");
    const avatar = await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "Pinned", status: "ACTIVE" } }),
    );
    const application = await withAuthContext({ orgId, userId }, (tx) =>
      tx.application.create({ data: { orgId, name: "Widget", publishableKey: `pk_${randomUUID()}` } }),
    );

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/applications/${application.id}`,
      cookies: { avatrain_session: token },
      payload: { allowedOrigins: ["https://example.com"], avatarId: avatar.id, isEnabled: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().application).toEqual(
      expect.objectContaining({ allowedOrigins: ["https://example.com"], avatarId: avatar.id, isEnabled: false }),
    );
  });

  it("rejects a malformed origin", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Applications Patch Bad Origin Org");
    const application = await withAuthContext({ orgId, userId }, (tx) =>
      tx.application.create({ data: { orgId, name: "Widget", publishableKey: `pk_${randomUUID()}` } }),
    );

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/applications/${application.id}`,
      cookies: { avatrain_session: token },
      payload: { allowedOrigins: ["https://example.com/some/path"] },
    });
    expect(response.statusCode).toBe(400);
  });

  it("two-org isolation: 404s for another org's application", async () => {
    const { token } = await seedOrgWithSessionToken("Applications Patch Isolation Org");
    const otherOrg = await seedOrgWithSessionToken("Applications Patch Isolation Other Org");
    const otherApplication = await withAuthContext({ orgId: otherOrg.orgId, userId: otherOrg.userId }, (tx) =>
      tx.application.create({ data: { orgId: otherOrg.orgId, name: "Not Yours", publishableKey: `pk_${randomUUID()}` } }),
    );

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/applications/${otherApplication.id}`,
      cookies: { avatrain_session: token },
      payload: { name: "Hijacked" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("DELETE /v1/applications/:applicationId", () => {
  it("deletes the application", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Applications Delete Org");
    const application = await withAuthContext({ orgId, userId }, (tx) =>
      tx.application.create({ data: { orgId, name: "Widget", publishableKey: `pk_${randomUUID()}` } }),
    );

    const response = await app.inject({
      method: "DELETE",
      url: `/v1/applications/${application.id}`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(204);

    const stillThere = await withAuthContext({ orgId, userId }, (tx) =>
      tx.application.findUnique({ where: { id: application.id } }),
    );
    expect(stillThere).toBeNull();
  });

  it("two-org isolation: 404s for another org's application, and does not delete it", async () => {
    const { token } = await seedOrgWithSessionToken("Applications Delete Isolation Org");
    const otherOrg = await seedOrgWithSessionToken("Applications Delete Isolation Other Org");
    const otherApplication = await withAuthContext({ orgId: otherOrg.orgId, userId: otherOrg.userId }, (tx) =>
      tx.application.create({ data: { orgId: otherOrg.orgId, name: "Not Yours", publishableKey: `pk_${randomUUID()}` } }),
    );

    const response = await app.inject({
      method: "DELETE",
      url: `/v1/applications/${otherApplication.id}`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(404);

    const stillThere = await withAuthContext({ orgId: otherOrg.orgId, userId: otherOrg.userId }, (tx) =>
      tx.application.findUnique({ where: { id: otherApplication.id } }),
    );
    expect(stillThere).not.toBeNull();
  });
});
