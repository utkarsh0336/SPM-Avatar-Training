import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, setAuthContext, withAuthContext } from "@avatrain/shared";
import { getTrainingSessionForConnect, persistTrainingSessionMessage } from "./training-session-service.js";

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const orgId of createdOrgIds) {
    await withAuthContext({ orgId }, async (tx) => {
      await tx.message.deleteMany({ where: { orgId } });
      await tx.trainingSession.deleteMany({ where: { orgId } });
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

async function seedOrgAndUser(label: string): Promise<{ orgId: string; userId: string }> {
  const orgId = randomUUID();
  const userId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: label } });
    await tx.user.create({ data: { id: userId, email: `${label}-${randomUUID()}@example.com`, passwordHash: "seeded" } });
    await setAuthContext(tx, { userId, orgId });
    await tx.membership.create({ data: { orgId, userId, role: "OWNER" } });
  });
  createdOrgIds.push(orgId);
  createdUserIds.push(userId);
  return { orgId, userId };
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

describe("training-session-service", () => {
  describe("getTrainingSessionForConnect", () => {
    it("returns id/status for an org-owned session", async () => {
      const { orgId, userId } = await seedOrgAndUser("Connect Lookup Org");
      const session = await seedTrainingSession(orgId, userId);

      const result = await getTrainingSessionForConnect(orgId, session.id);
      expect(result).toEqual({ id: session.id, status: "ACTIVE" });
    });

    it("returns null for another org's session (RLS-backed, not a thrown error)", async () => {
      const { orgId } = await seedOrgAndUser("Connect Lookup Owner Org");
      const otherOrg = await seedOrgAndUser("Connect Lookup Other Org");
      const session = await seedTrainingSession(otherOrg.orgId, otherOrg.userId);

      const result = await getTrainingSessionForConnect(orgId, session.id);
      expect(result).toBeNull();
    });
  });

  describe("persistTrainingSessionMessage", () => {
    it("inserts a Message row and bumps the TrainingSession's updatedAt", async () => {
      const { orgId, userId } = await seedOrgAndUser("Persist Message Org");
      const session = await seedTrainingSession(orgId, userId);

      await persistTrainingSessionMessage(orgId, session.id, "USER", "Hello there");

      const messages = await withAuthContext({ orgId, userId }, (tx) =>
        tx.message.findMany({ where: { orgId, trainingSessionId: session.id } }),
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(expect.objectContaining({ role: "USER", content: "Hello there", sequence: 0 }));

      const updated = await withAuthContext({ orgId, userId }, (tx) =>
        tx.trainingSession.findFirstOrThrow({ where: { id: session.id } }),
      );
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(session.updatedAt.getTime());
    });

    it("redacts PII in content before persisting", async () => {
      const { orgId, userId } = await seedOrgAndUser("Redact Message Org");
      const session = await seedTrainingSession(orgId, userId);

      await persistTrainingSessionMessage(orgId, session.id, "USER", "reach me at a@b.com");

      const messages = await withAuthContext({ orgId, userId }, (tx) =>
        tx.message.findMany({ where: { orgId, trainingSessionId: session.id } }),
      );
      expect(messages[0]?.content).toBe("reach me at [REDACTED_EMAIL]");
    });

    it("never throws — a persistence failure (unknown trainingSessionId) is caught and swallowed", async () => {
      const { orgId } = await seedOrgAndUser("Persist Message Failure Org");
      await expect(
        persistTrainingSessionMessage(orgId, randomUUID(), "USER", "orphaned turn"),
      ).resolves.toBeUndefined();
    });

    it("computes sequence from MAX(sequence)+1 — a reconnect (fresh call, no in-memory counter) continues numbering instead of colliding with already-persisted rows", async () => {
      const { orgId, userId } = await seedOrgAndUser("Persist Message Reconnect Org");
      const session = await seedTrainingSession(orgId, userId);

      // Simulates one WS connection's turns...
      await persistTrainingSessionMessage(orgId, session.id, "USER", "first");
      await persistTrainingSessionMessage(orgId, session.id, "AVATAR", "first reply");
      // ...then a reconnect: a brand-new createConversationHandler call, whose own sequence
      // bookkeeping (if any existed client-side) would restart at 0 — this must NOT collide.
      await persistTrainingSessionMessage(orgId, session.id, "USER", "second, after reconnect");

      const messages = await withAuthContext({ orgId, userId }, (tx) =>
        tx.message.findMany({ where: { orgId, trainingSessionId: session.id }, orderBy: { sequence: "asc" } }),
      );
      expect(messages.map((m) => [m.sequence, m.content])).toEqual([
        [0, "first"],
        [1, "first reply"],
        [2, "second, after reconnect"],
      ]);
    });
  });
});
