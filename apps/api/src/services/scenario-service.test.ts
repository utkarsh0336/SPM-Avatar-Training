import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, setAuthContext, withAuthContext } from "@avatrain/shared";
import { createCurriculum, replaceObjectives } from "./curriculum-service.js";
import { replaceObjectiveScenario } from "./scenario-service.js";

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const orgId of createdOrgIds) {
    await withAuthContext({ orgId }, async (tx) => {
      // Objective/ScenarioStep/ScenarioBranch cascade via curricula's FK ON DELETE CASCADE.
      await tx.curriculum.deleteMany({ where: { orgId } });
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

async function seedOrgAndUser(label: string): Promise<{ orgId: string; userId: string }> {
  const orgId = randomUUID();
  const userId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: label } });
    await tx.user.create({
      data: { id: userId, email: `${label}-${randomUUID()}@example.com`, passwordHash: "seeded" },
    });
    await setAuthContext(tx, { userId, orgId });
    await tx.membership.create({ data: { orgId, userId, role: "OWNER" } });
  });
  createdOrgIds.push(orgId);
  createdUserIds.push(userId);
  return { orgId, userId };
}

async function seedAvatar(orgId: string, userId: string): Promise<string> {
  const avatar = await withAuthContext({ orgId, userId }, (tx) =>
    tx.avatar.create({ data: { orgId, createdById: userId, name: "Test Avatar" } }),
  );
  return avatar.id;
}

async function seedObjective(orgId: string, userId: string): Promise<string> {
  const avatarId = await seedAvatar(orgId, userId);
  const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
  const [objective] = await replaceObjectives(orgId, curriculum.id, [
    { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
  ]);
  return objective!.id;
}

describe("scenario-service", () => {
  describe("replaceObjectiveScenario", () => {
    it("creates a two-step scenario and resolves nextStepOrder to real ids", async () => {
      const { orgId, userId } = await seedOrgAndUser("Scenario Create Org");
      const objectiveId = await seedObjective(orgId, userId);

      const saved = await replaceObjectiveScenario(orgId, objectiveId, [
        {
          order: 0,
          prompt: "A customer complains about a late delivery. What do you say?",
          branches: [
            { order: 0, matchCriteria: "Apologizes and offers a resolution", nextStepOrder: 1, outcome: null },
            { order: 1, matchCriteria: "Dismisses the complaint", nextStepOrder: null, outcome: "RETRY" },
          ],
        },
        {
          order: 1,
          prompt: "The customer is still upset. What now?",
          branches: [{ order: 0, matchCriteria: "Escalates to a manager", nextStepOrder: null, outcome: "PASS" }],
        },
      ]);

      expect(saved).toHaveLength(2);
      const [stepA, stepB] = saved;
      expect(stepA!.branches[0]).toMatchObject({ nextStepId: stepB!.id, outcome: null });
      expect(stepA!.branches[1]).toMatchObject({ nextStepId: null, outcome: "RETRY" });
      expect(stepB!.branches[0]).toMatchObject({ nextStepId: null, outcome: "PASS" });
    });

    it("clears an existing scenario when steps is empty", async () => {
      const { orgId, userId } = await seedOrgAndUser("Scenario Clear Org");
      const objectiveId = await seedObjective(orgId, userId);

      await replaceObjectiveScenario(orgId, objectiveId, [
        { order: 0, prompt: "P", branches: [{ order: 0, matchCriteria: "M", nextStepOrder: null, outcome: "PASS" }] },
      ]);
      const cleared = await replaceObjectiveScenario(orgId, objectiveId, []);
      expect(cleared).toEqual([]);
    });

    it("404s for another org's objective", async () => {
      const orgA = await seedOrgAndUser("Scenario NotFound Org A");
      const orgB = await seedOrgAndUser("Scenario NotFound Org B");
      const objectiveId = await seedObjective(orgA.orgId, orgA.userId);

      await expect(
        replaceObjectiveScenario(orgB.orgId, objectiveId, [
          { order: 0, prompt: "P", branches: [{ order: 0, matchCriteria: "M", nextStepOrder: null, outcome: "PASS" }] },
        ]),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("400s when a branch has both nextStepOrder and outcome resolved elsewhere but points at a missing step", async () => {
      const { orgId, userId } = await seedOrgAndUser("Scenario Dangling Org");
      const objectiveId = await seedObjective(orgId, userId);

      await expect(
        replaceObjectiveScenario(orgId, objectiveId, [
          { order: 0, prompt: "P", branches: [{ order: 0, matchCriteria: "M", nextStepOrder: 5, outcome: null }] },
        ]),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("400s on duplicate step orders", async () => {
      const { orgId, userId } = await seedOrgAndUser("Scenario Dup Step Org");
      const objectiveId = await seedObjective(orgId, userId);

      await expect(
        replaceObjectiveScenario(orgId, objectiveId, [
          { order: 0, prompt: "P1", branches: [{ order: 0, matchCriteria: "M", nextStepOrder: null, outcome: "PASS" }] },
          { order: 0, prompt: "P2", branches: [{ order: 0, matchCriteria: "M", nextStepOrder: null, outcome: "PASS" }] },
        ]),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("400s on duplicate branch orders within a step", async () => {
      const { orgId, userId } = await seedOrgAndUser("Scenario Dup Branch Org");
      const objectiveId = await seedObjective(orgId, userId);

      await expect(
        replaceObjectiveScenario(orgId, objectiveId, [
          {
            order: 0,
            prompt: "P",
            branches: [
              { order: 0, matchCriteria: "M1", nextStepOrder: null, outcome: "PASS" },
              { order: 0, matchCriteria: "M2", nextStepOrder: null, outcome: "RETRY" },
            ],
          },
        ]),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
