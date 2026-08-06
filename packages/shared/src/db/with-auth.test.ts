import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "./client.js";
import { setAuthContext, withAuthContext } from "./with-auth.js";
import { sha256Hex } from "../auth/tokens.js";

const unreachableTx = {
  $executeRawUnsafe: async () => {
    throw new Error("$executeRawUnsafe should not be reached for invalid input");
  },
} as unknown as Prisma.TransactionClient;

describe("setAuthContext — injection guard", () => {
  it("rejects a non-UUID userId before touching the database", async () => {
    await expect(setAuthContext(unreachableTx, { userId: "not-a-uuid" })).rejects.toThrow();
  });

  it("rejects a non-UUID orgId, including SQL-injection-shaped input", async () => {
    await expect(
      setAuthContext(unreachableTx, { orgId: "'; DROP TABLE sessions; --" }),
    ).rejects.toThrow();
  });

  it("rejects a malformed sessionLookupHash", async () => {
    await expect(
      setAuthContext(unreachableTx, { sessionLookupHash: "not-a-hex-digest" }),
    ).rejects.toThrow();
  });

  it("accepts a context with nothing set (no-op)", async () => {
    await expect(setAuthContext(unreachableTx, {})).resolves.toBeUndefined();
  });
});

describe("withAuthContext — RLS self-lookup", () => {
  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  // Unique per run, unlike a fixed literal, so a leftover row from a
  // previously-failed run can never collide with sessions.token_hash's
  // unique constraint on a rerun.
  const tokenHashA = sha256Hex(`token-a-${randomUUID()}`);
  const tokenHashB = sha256Hex(`token-b-${randomUUID()}`);

  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        { id: orgAId, name: "with-auth Test Org A" },
        { id: orgBId, name: "with-auth Test Org B" },
      ],
    });
    await prisma.user.createMany({
      data: [
        { id: userAId, email: `user-a-${userAId}@example.com` },
        { id: userBId, email: `user-b-${userBId}@example.com` },
      ],
    });
    await withAuthContext({ userId: userAId, orgId: orgAId }, (tx) =>
      tx.membership.create({ data: { orgId: orgAId, userId: userAId, role: "OWNER" } }),
    );
    await withAuthContext({ userId: userBId, orgId: orgBId }, (tx) =>
      tx.membership.create({ data: { orgId: orgBId, userId: userBId, role: "OWNER" } }),
    );
    const expiresAt = new Date(Date.now() + 3_600_000);
    await withAuthContext({ userId: userAId, orgId: orgAId }, (tx) =>
      tx.session.create({
        data: { orgId: orgAId, userId: userAId, tokenHash: tokenHashA, expiresAt },
      }),
    );
    await withAuthContext({ userId: userBId, orgId: orgBId }, (tx) =>
      tx.session.create({
        data: { orgId: orgBId, userId: userBId, tokenHash: tokenHashB, expiresAt },
      }),
    );
  });

  afterAll(async () => {
    await withAuthContext({ userId: userAId }, (tx) =>
      tx.session.deleteMany({ where: { userId: userAId } }),
    );
    await withAuthContext({ userId: userBId }, (tx) =>
      tx.session.deleteMany({ where: { userId: userBId } }),
    );
    await withAuthContext({ userId: userAId }, (tx) =>
      tx.membership.deleteMany({ where: { userId: userAId } }),
    );
    await withAuthContext({ userId: userBId }, (tx) =>
      tx.membership.deleteMany({ where: { userId: userBId } }),
    );
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  });

  it("a bare sessionLookupHash context only sees its own session row", async () => {
    const sessions = await withAuthContext({ sessionLookupHash: tokenHashA }, (tx) =>
      tx.session.findMany(),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).toBe(tokenHashA);
    expect(sessions[0]?.userId).toBe(userAId);
  });

  it("a bare userId context only sees its own membership row, not the other org's", async () => {
    const memberships = await withAuthContext({ userId: userAId }, (tx) =>
      tx.membership.findMany(),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.orgId).toBe(orgAId);
  });
});
