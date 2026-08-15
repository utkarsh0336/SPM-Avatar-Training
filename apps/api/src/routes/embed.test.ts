import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, withAuthContext } from "@avatrain/shared";
import { buildApp } from "../app.js";
import { redeemWsTicket } from "../lib/ws-tickets.js";

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const orgId of createdOrgIds) {
    await withAuthContext({ orgId }, async (tx) => {
      await tx.application.deleteMany({ where: { orgId } });
      await tx.avatar.deleteMany({ where: { orgId } });
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

const COMPLETE_AVATAR = {
  name: "Priya",
  style: "REALISTIC" as const,
  gender: "FEMALE" as const,
  skinTone: "TONE_2",
  hairStyle: "MEDIUM" as const,
  hairColor: "AUBURN",
  outfit: "BUSINESS_FORMAL" as const,
  expertise: "HR_LEAVE_POLICY" as const,
  voice: "WARM" as const,
  status: "ACTIVE" as const,
};

interface SeededEmbed {
  orgId: string;
  userId: string;
  avatarId: string;
  publishableKey: string;
}

type AvatarOverrides = Omit<Partial<typeof COMPLETE_AVATAR>, "status"> & { status?: "DRAFT" | "ACTIVE" | "ARCHIVED" };

async function seedEnabledEmbed(
  orgName: string,
  options: { allowedOrigins?: string[]; isEnabled?: boolean; avatar?: AvatarOverrides | null } = {},
): Promise<SeededEmbed> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const publishableKey = `pk_test_${randomUUID()}`;

  await prisma.organization.create({ data: { id: orgId, name: orgName } });
  await prisma.user.create({ data: { id: userId, email: `${orgName}-${randomUUID()}@example.com`, passwordHash: "seeded" } });

  let avatarId = "";
  await withAuthContext({ orgId, userId }, async (tx) => {
    if (options.avatar !== null) {
      const avatar = await tx.avatar.create({
        data: { orgId, createdById: userId, ...COMPLETE_AVATAR, ...options.avatar },
      });
      avatarId = avatar.id;
    }
    await tx.application.create({
      data: {
        orgId,
        name: "Test Embed",
        publishableKey,
        allowedOrigins: options.allowedOrigins ?? ["https://example.com"],
        isEnabled: options.isEnabled ?? true,
        avatarId: avatarId || null,
      },
    });
  });

  createdOrgIds.push(orgId);
  createdUserIds.push(userId);
  return { orgId, userId, avatarId, publishableKey };
}

describe("GET /v1/embed/config", () => {
  it("404s for an unknown key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/embed/config?key=pk_does_not_exist",
      headers: { origin: "https://example.com" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("403s when the request's Origin isn't on the allowlist", async () => {
    const { publishableKey } = await seedEnabledEmbed("Embed Config Origin Org");
    const response = await app.inject({
      method: "GET",
      url: `/v1/embed/config?key=${publishableKey}`,
      headers: { origin: "https://evil.example.com" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("403s when no Origin header is sent at all", async () => {
    const { publishableKey } = await seedEnabledEmbed("Embed Config No Origin Org");
    const response = await app.inject({ method: "GET", url: `/v1/embed/config?key=${publishableKey}` });
    expect(response.statusCode).toBe(403);
  });

  it("503s when the Application is disabled", async () => {
    const { publishableKey } = await seedEnabledEmbed("Embed Config Disabled Org", { isEnabled: false });
    const response = await app.inject({
      method: "GET",
      url: `/v1/embed/config?key=${publishableKey}`,
      headers: { origin: "https://example.com" },
    });
    expect(response.statusCode).toBe(503);
  });

  it("503s when no avatar is pinned yet", async () => {
    const { publishableKey } = await seedEnabledEmbed("Embed Config No Avatar Org", { avatar: null });
    const response = await app.inject({
      method: "GET",
      url: `/v1/embed/config?key=${publishableKey}`,
      headers: { origin: "https://example.com" },
    });
    expect(response.statusCode).toBe(503);
  });

  it("503s when the pinned avatar isn't ACTIVE", async () => {
    const { publishableKey } = await seedEnabledEmbed("Embed Config Draft Avatar Org", { avatar: { status: "DRAFT" } });
    const response = await app.inject({
      method: "GET",
      url: `/v1/embed/config?key=${publishableKey}`,
      headers: { origin: "https://example.com" },
    });
    expect(response.statusCode).toBe(503);
  });

  it("returns the persona config and sets exact-origin CORS headers for an allowed origin", async () => {
    const { publishableKey, avatarId } = await seedEnabledEmbed("Embed Config Success Org");
    const response = await app.inject({
      method: "GET",
      url: `/v1/embed/config?key=${publishableKey}`,
      headers: { origin: "https://example.com" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://example.com");
    expect(response.headers.vary).toBe("Origin");
    expect(response.json()).toEqual({
      avatarId,
      avatarName: "Priya",
      expertise: "HR_LEAVE_POLICY",
      voiceTone: "WARM",
      style: "REALISTIC",
      gender: "FEMALE",
      outfit: "BUSINESS_FORMAL",
      skinTone: "TONE_2",
      hairStyle: "MEDIUM",
      hairColor: "AUBURN",
    });
  });

  it("never reveals another org's persona for a mismatched key/org combination", async () => {
    const orgA = await seedEnabledEmbed("Embed Config Isolation Org A");
    await seedEnabledEmbed("Embed Config Isolation Org B");

    const response = await app.inject({
      method: "GET",
      url: `/v1/embed/config?key=${orgA.publishableKey}`,
      headers: { origin: "https://example.com" },
    });
    expect(response.json().avatarId).toBe(orgA.avatarId);
  });
});

describe("POST /v1/embed/ticket", () => {
  it("mints a ticket with userId: null and the pinned avatarId, redeemable exactly once", async () => {
    const { publishableKey, orgId, avatarId } = await seedEnabledEmbed("Embed Ticket Org");
    const response = await app.inject({
      method: "POST",
      url: `/v1/embed/ticket?key=${publishableKey}`,
      headers: { origin: "https://example.com" },
    });
    expect(response.statusCode).toBe(201);
    const { ticket } = response.json();

    const claims = await redeemWsTicket(ticket);
    expect(claims).toEqual({ orgId, userId: null, pinnedAvatarId: avatarId });
    expect(await redeemWsTicket(ticket)).toBeNull(); // single-use
  });

  it("403s when the request's Origin isn't on the allowlist", async () => {
    const { publishableKey } = await seedEnabledEmbed("Embed Ticket Origin Org");
    const response = await app.inject({
      method: "POST",
      url: `/v1/embed/ticket?key=${publishableKey}`,
      headers: { origin: "https://evil.example.com" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("503s when no avatar is pinned yet", async () => {
    const { publishableKey } = await seedEnabledEmbed("Embed Ticket No Avatar Org", { avatar: null });
    const response = await app.inject({
      method: "POST",
      url: `/v1/embed/ticket?key=${publishableKey}`,
      headers: { origin: "https://example.com" },
    });
    expect(response.statusCode).toBe(503);
  });
});
