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
      await tx.trainingSessionPin.deleteMany({ where: { orgId } });
      await tx.message.deleteMany({ where: { orgId } });
      await tx.trainingSession.deleteMany({ where: { orgId } });
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

async function seedActiveAvatar(orgId: string, userId: string, name = "My Avatar") {
  return withAuthContext({ orgId, userId }, (tx) =>
    tx.avatar.create({
      data: { orgId, createdById: userId, name, status: "ACTIVE", expertise: "HR_LEAVE_POLICY" },
    }),
  );
}

describe("POST /v1/training-sessions", () => {
  it("requires authentication", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      payload: { kind: "VOICE_ONLY", title: "x", voiceExpertId: "priya", clientRequestId: randomUUID() },
    });
    expect(response.statusCode).toBe(401);
  });

  it("creates a VIDEO_CHAT session against an ACTIVE avatar, resolving persona server-side", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Training Sessions Create Video Org");
    const avatar = await seedActiveAvatar(orgId, userId);

    const response = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: {
        kind: "VIDEO_CHAT",
        title: "Sales Pitch Practice",
        avatarId: avatar.id,
        clientRequestId: randomUUID(),
      },
    });
    expect(response.statusCode).toBe(201);
    const { trainingSession } = response.json();
    expect(trainingSession).toEqual(
      expect.objectContaining({
        kind: "VIDEO_CHAT",
        status: "ACTIVE",
        avatarId: avatar.id,
        voiceExpertId: null,
        personaName: "My Avatar",
        personaRole: "HR & Leave Policy",
      }),
    );
  });

  it("creates a VIDEO_CHAT session with no avatarId by falling back to the caller's own ACTIVE-first avatar", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Training Sessions Create Video Fallback Org");
    const avatar = await seedActiveAvatar(orgId, userId, "Default Persona");

    const response = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: { kind: "VIDEO_CHAT", title: "Onboarding Rehearsal", clientRequestId: randomUUID() },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().trainingSession).toEqual(
      expect.objectContaining({ avatarId: avatar.id, personaName: "Default Persona" }),
    );
  });

  it("400s when no avatarId is given and the caller has no avatar at all", async () => {
    const { token } = await seedOrgWithSessionToken("Training Sessions No Avatar Org");

    const response = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: { kind: "VIDEO_CHAT", title: "x", clientRequestId: randomUUID() },
    });
    expect(response.statusCode).toBe(400);
  });

  it("creates a VOICE_ONLY session against a known voice expert, with no avatarId", async () => {
    const { token } = await seedOrgWithSessionToken("Training Sessions Create Voice Org");

    const response = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: {
        kind: "VOICE_ONLY",
        title: "Maternity Leave Policy",
        voiceExpertId: "priya",
        clientRequestId: randomUUID(),
      },
    });
    expect(response.statusCode).toBe(201);
    const { trainingSession } = response.json();
    expect(trainingSession).toEqual(
      expect.objectContaining({
        kind: "VOICE_ONLY",
        avatarId: null,
        voiceExpertId: "priya",
        personaName: "Priya",
        personaRole: "HR Expert",
      }),
    );
  });

  it("400s for a DRAFT (not yet ACTIVE) avatar", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Training Sessions Draft Avatar Org");
    const avatar = await withAuthContext({ orgId, userId }, (tx) =>
      tx.avatar.create({ data: { orgId, createdById: userId, name: "Draft", status: "DRAFT" } }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: { kind: "VIDEO_CHAT", title: "x", avatarId: avatar.id, clientRequestId: randomUUID() },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s for an unknown voiceExpertId", async () => {
    const { token } = await seedOrgWithSessionToken("Training Sessions Unknown Voice Expert Org");

    const response = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: { kind: "VOICE_ONLY", title: "x", voiceExpertId: "not-a-real-expert", clientRequestId: randomUUID() },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s for a request mixing kind=VIDEO_CHAT with voiceExpertId", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Training Sessions Mismatched Kind Org");
    const avatar = await seedActiveAvatar(orgId, userId);

    const response = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: {
        kind: "VIDEO_CHAT",
        title: "x",
        avatarId: avatar.id,
        voiceExpertId: "priya",
        clientRequestId: randomUUID(),
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("is idempotent on clientRequestId: a retried create returns the original row, not a duplicate", async () => {
    const { token } = await seedOrgWithSessionToken("Training Sessions Idempotent Org");
    const clientRequestId = randomUUID();
    const payload = { kind: "VOICE_ONLY", title: "x", voiceExpertId: "marcus", clientRequestId };

    const first = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().trainingSession.id).toBe(first.json().trainingSession.id);
  });
});

describe("GET /v1/training-sessions", () => {
  it("splits pinned from recent and filters by kind", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Training Sessions List Org");

    const toPin = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: { kind: "VOICE_ONLY", title: "Pin me", voiceExpertId: "priya", clientRequestId: randomUUID() },
    });
    await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: { kind: "VOICE_ONLY", title: "Just recent", voiceExpertId: "marcus", clientRequestId: randomUUID() },
    });
    const avatar = await seedActiveAvatar(orgId, userId);
    await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: { kind: "VIDEO_CHAT", title: "Wrong kind", avatarId: avatar.id, clientRequestId: randomUUID() },
    });

    await app.inject({
      method: "PATCH",
      url: `/v1/training-sessions/${toPin.json().trainingSession.id}/pin`,
      cookies: { avatrain_session: token },
      payload: { pinned: true },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/training-sessions?kind=VOICE_ONLY",
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(200);
    const { pinned, recent } = response.json();
    expect(pinned).toEqual([expect.objectContaining({ title: "Pin me" })]);
    expect(recent).toEqual([expect.objectContaining({ title: "Just recent" })]);
  });

  it("two-org isolation: never returns another org's sessions", async () => {
    const { token, orgId, userId } = await seedOrgWithSessionToken("Training Sessions Isolation List Org");
    const otherOrg = await seedOrgWithSessionToken("Training Sessions Isolation List Other Org");
    await withAuthContext({ orgId, userId }, (tx) =>
      tx.trainingSession.create({
        data: {
          orgId,
          createdByUserId: userId,
          clientRequestId: randomUUID(),
          kind: "VOICE_ONLY",
          title: "Mine",
          voiceExpertId: "priya",
          personaName: "Priya",
          personaRole: "HR Expert",
        },
      }),
    );
    await withAuthContext({ orgId: otherOrg.orgId, userId: otherOrg.userId }, (tx) =>
      tx.trainingSession.create({
        data: {
          orgId: otherOrg.orgId,
          createdByUserId: otherOrg.userId,
          clientRequestId: randomUUID(),
          kind: "VOICE_ONLY",
          title: "Not Yours",
          voiceExpertId: "priya",
          personaName: "Priya",
          personaRole: "HR Expert",
        },
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/training-sessions?kind=VOICE_ONLY",
      cookies: { avatrain_session: token },
    });
    expect(response.json().recent).toEqual([expect.objectContaining({ title: "Mine" })]);
  });
});

describe("GET /v1/training-sessions/:trainingSessionId", () => {
  it("404s for a missing id", async () => {
    const { token } = await seedOrgWithSessionToken("Training Sessions Get Missing Org");
    const response = await app.inject({
      method: "GET",
      url: `/v1/training-sessions/${randomUUID()}`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(404);
  });

  it("two-org isolation: 404s for another org's session", async () => {
    const { token } = await seedOrgWithSessionToken("Training Sessions Get Isolation Org");
    const otherOrg = await seedOrgWithSessionToken("Training Sessions Get Isolation Other Org");
    const created = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: otherOrg.token },
      payload: { kind: "VOICE_ONLY", title: "Not Yours", voiceExpertId: "priya", clientRequestId: randomUUID() },
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/training-sessions/${created.json().trainingSession.id}`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /v1/training-sessions/:trainingSessionId/messages", () => {
  it("returns an empty page for a freshly-created session", async () => {
    const { token } = await seedOrgWithSessionToken("Training Sessions Messages Empty Org");
    const created = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: { kind: "VOICE_ONLY", title: "x", voiceExpertId: "priya", clientRequestId: randomUUID() },
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/training-sessions/${created.json().trainingSession.id}/messages`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ messages: [], nextAfter: null });
  });

  it("404s for another org's session", async () => {
    const { token } = await seedOrgWithSessionToken("Training Sessions Messages Isolation Org");
    const otherOrg = await seedOrgWithSessionToken("Training Sessions Messages Isolation Other Org");
    const created = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: otherOrg.token },
      payload: { kind: "VOICE_ONLY", title: "Not Yours", voiceExpertId: "priya", clientRequestId: randomUUID() },
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/training-sessions/${created.json().trainingSession.id}/messages`,
      cookies: { avatrain_session: token },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("POST /v1/training-sessions/:trainingSessionId/end", () => {
  it("ends an ACTIVE session and is idempotent on a second call", async () => {
    const { token } = await seedOrgWithSessionToken("Training Sessions End Org");
    const created = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: { kind: "VOICE_ONLY", title: "x", voiceExpertId: "priya", clientRequestId: randomUUID() },
    });
    const id = created.json().trainingSession.id;

    const first = await app.inject({
      method: "POST",
      url: `/v1/training-sessions/${id}/end`,
      cookies: { avatrain_session: token },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().trainingSession).toEqual(
      expect.objectContaining({ status: "ENDED", endReason: "USER_ENDED" }),
    );

    const second = await app.inject({
      method: "POST",
      url: `/v1/training-sessions/${id}/end`,
      cookies: { avatrain_session: token },
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().trainingSession.endedAt).toBe(first.json().trainingSession.endedAt);
  });
});

describe("PATCH /v1/training-sessions/:trainingSessionId/pin", () => {
  it("pins then unpins a session", async () => {
    const { token } = await seedOrgWithSessionToken("Training Sessions Pin Org");
    const created = await app.inject({
      method: "POST",
      url: "/v1/training-sessions",
      cookies: { avatrain_session: token },
      payload: { kind: "VOICE_ONLY", title: "x", voiceExpertId: "priya", clientRequestId: randomUUID() },
    });
    const id = created.json().trainingSession.id;

    const pin = await app.inject({
      method: "PATCH",
      url: `/v1/training-sessions/${id}/pin`,
      cookies: { avatrain_session: token },
      payload: { pinned: true },
    });
    expect(pin.statusCode).toBe(200);
    expect(pin.json()).toEqual({ pinned: true });

    // Pinning twice must not throw a unique-constraint error.
    await app.inject({
      method: "PATCH",
      url: `/v1/training-sessions/${id}/pin`,
      cookies: { avatrain_session: token },
      payload: { pinned: true },
    });

    const unpin = await app.inject({
      method: "PATCH",
      url: `/v1/training-sessions/${id}/pin`,
      cookies: { avatrain_session: token },
      payload: { pinned: false },
    });
    expect(unpin.statusCode).toBe(200);
    expect(unpin.json()).toEqual({ pinned: false });
  });
});
