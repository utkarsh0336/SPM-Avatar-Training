import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, setAuthContext, withAuthContext } from "@avatrain/shared";
import {
  createCurriculum,
  deleteCurriculum,
  getCurriculum,
  getCurriculumForAvatar,
  listCurriculumProgress,
  replaceObjectives,
} from "./curriculum-service.js";

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const orgId of createdOrgIds) {
    await withAuthContext({ orgId }, async (tx) => {
      // Objective/ObjectiveProgress cascade via curricula's FK ON DELETE CASCADE.
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

describe("curriculum-service", () => {
  describe("createCurriculum", () => {
    it("creates a curriculum for an avatar owned by the caller's org", async () => {
      const { orgId, userId } = await seedOrgAndUser("Create Curriculum Org");
      const avatarId = await seedAvatar(orgId, userId);

      const result = await createCurriculum(orgId, userId, { avatarId, title: "Onboarding" });
      expect(result.avatarId).toBe(avatarId);
      expect(result.title).toBe("Onboarding");
    });

    it("404s for an avatar belonging to a different org", async () => {
      const orgA = await seedOrgAndUser("Create Curriculum Org A");
      const orgB = await seedOrgAndUser("Create Curriculum Org B");
      const avatarId = await seedAvatar(orgA.orgId, orgA.userId);

      await expect(createCurriculum(orgB.orgId, orgB.userId, { avatarId, title: "X" })).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("409s when the avatar already has a curriculum", async () => {
      const { orgId, userId } = await seedOrgAndUser("Duplicate Curriculum Org");
      const avatarId = await seedAvatar(orgId, userId);
      await createCurriculum(orgId, userId, { avatarId, title: "First" });

      await expect(createCurriculum(orgId, userId, { avatarId, title: "Second" })).rejects.toMatchObject({
        statusCode: 409,
        code: "curriculum_exists",
      });
    });
  });

  describe("getCurriculum", () => {
    it("404s for a curriculum belonging to a different org", async () => {
      const orgA = await seedOrgAndUser("Get Curriculum Org A");
      const orgB = await seedOrgAndUser("Get Curriculum Org B");
      const avatarId = await seedAvatar(orgA.orgId, orgA.userId);
      const curriculum = await createCurriculum(orgA.orgId, orgA.userId, { avatarId, title: "X" });

      await expect(getCurriculum(orgB.orgId, curriculum.id)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("replaceObjectives", () => {
    it("creates objectives from a list with no ids, assigning order from array position", async () => {
      const { orgId, userId } = await seedOrgAndUser("Replace Create Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });

      const saved = await replaceObjectives(orgId, curriculum.id, [
        { title: "First", teachingContent: "T1", checkQuestion: "Q1", gradingCriteria: "G1" },
        { title: "Second", teachingContent: "T2", checkQuestion: "Q2", gradingCriteria: "G2" },
      ]);

      expect(saved).toHaveLength(2);
      expect(saved[0]!.title).toBe("First");
      expect(saved[0]!.order).toBe(0);
      expect(saved[1]!.title).toBe("Second");
      expect(saved[1]!.order).toBe(1);
    });

    it("updates existing objectives in place by id, preserving the id", async () => {
      const { orgId, userId } = await seedOrgAndUser("Replace Update Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
      const initial = await replaceObjectives(orgId, curriculum.id, [
        { title: "Original", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      const objectiveId = initial[0]!.id;

      const updated = await replaceObjectives(orgId, curriculum.id, [
        { id: objectiveId, title: "Renamed", teachingContent: "T2", checkQuestion: "Q2", gradingCriteria: "G2" },
      ]);

      expect(updated).toHaveLength(1);
      expect(updated[0]!.id).toBe(objectiveId);
      expect(updated[0]!.title).toBe("Renamed");
    });

    it("deletes objectives omitted from the new list", async () => {
      const { orgId, userId } = await seedOrgAndUser("Replace Delete Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
      const initial = await replaceObjectives(orgId, curriculum.id, [
        { title: "Keep", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
        { title: "Drop", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      const keepId = initial[0]!.id;

      const after = await replaceObjectives(orgId, curriculum.id, [
        { id: keepId, title: "Keep", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);

      expect(after).toHaveLength(1);
      expect(after[0]!.id).toBe(keepId);
    });

    it("reorders two existing objectives without a unique-constraint error", async () => {
      const { orgId, userId } = await seedOrgAndUser("Replace Reorder Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
      const initial = await replaceObjectives(orgId, curriculum.id, [
        { title: "A", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
        { title: "B", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      const [a, b] = initial;

      const swapped = await replaceObjectives(orgId, curriculum.id, [
        { id: b!.id, title: "B", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
        { id: a!.id, title: "A", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);

      expect(swapped[0]!.id).toBe(b!.id);
      expect(swapped[0]!.order).toBe(0);
      expect(swapped[1]!.id).toBe(a!.id);
      expect(swapped[1]!.order).toBe(1);
    });

    it("400s for an id that does not belong to this curriculum", async () => {
      const { orgId, userId } = await seedOrgAndUser("Replace Foreign Id Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });

      await expect(
        replaceObjectives(orgId, curriculum.id, [
          { id: randomUUID(), title: "X", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
        ]),
      ).rejects.toMatchObject({ statusCode: 400, code: "objective_not_found" });
    });
  });

  describe("deleteCurriculum", () => {
    it("removes the curriculum and its objectives", async () => {
      const { orgId, userId } = await seedOrgAndUser("Delete Curriculum Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
      await replaceObjectives(orgId, curriculum.id, [
        { title: "A", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);

      await deleteCurriculum(orgId, curriculum.id);

      await expect(getCurriculum(orgId, curriculum.id)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("404s for another org's curriculum", async () => {
      const orgA = await seedOrgAndUser("Delete NotFound Org A");
      const orgB = await seedOrgAndUser("Delete NotFound Org B");
      const avatarId = await seedAvatar(orgA.orgId, orgA.userId);
      const curriculum = await createCurriculum(orgA.orgId, orgA.userId, { avatarId, title: "X" });

      await expect(deleteCurriculum(orgB.orgId, curriculum.id)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("getCurriculumForAvatar", () => {
    it("returns NOT_STARTED for every objective when the learner has no progress rows", async () => {
      const { orgId, userId } = await seedOrgAndUser("Adaptive NotStarted Org");
      const learner = await seedOrgAndUser("Adaptive NotStarted Learner Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
      await replaceObjectives(orgId, curriculum.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);

      const result = await getCurriculumForAvatar(orgId, avatarId, learner.userId);
      expect(result?.objectives).toHaveLength(1);
      expect(result?.objectives[0]).toMatchObject({ status: "NOT_STARTED" });
      expect(result?.objectives[0]?.lastFeedback).toBeUndefined();
    });

    it("marks a PASSed objective MASTERED", async () => {
      const { orgId, userId } = await seedOrgAndUser("Adaptive Mastered Org");
      const learner = await seedOrgAndUser("Adaptive Mastered Learner Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
      const [objective] = await replaceObjectives(orgId, curriculum.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      await withAuthContext({ orgId }, (tx) =>
        tx.objectiveProgress.create({
          data: { orgId, objectiveId: objective!.id, learnerId: learner.userId, verdict: "PASS", attempts: 1, feedback: "Correct." },
        }),
      );

      const result = await getCurriculumForAvatar(orgId, avatarId, learner.userId);
      expect(result?.objectives[0]).toMatchObject({ status: "MASTERED", attempts: 1 });
    });

    it("marks a RETRY'd objective NEEDS_REVIEW and carries its last feedback", async () => {
      const { orgId, userId } = await seedOrgAndUser("Adaptive NeedsReview Org");
      const learner = await seedOrgAndUser("Adaptive NeedsReview Learner Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
      const [objective] = await replaceObjectives(orgId, curriculum.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      await withAuthContext({ orgId }, (tx) =>
        tx.objectiveProgress.create({
          data: {
            orgId,
            objectiveId: objective!.id,
            learnerId: learner.userId,
            verdict: "RETRY",
            attempts: 2,
            feedback: "Missed the manager sign-off step.",
          },
        }),
      );

      const result = await getCurriculumForAvatar(orgId, avatarId, learner.userId);
      expect(result?.objectives[0]).toMatchObject({
        status: "NEEDS_REVIEW",
        lastFeedback: "Missed the manager sign-off step.",
        attempts: 2,
      });
    });

    it("returns every objective NOT_STARTED when learnerId is null (anonymous/embed sessions)", async () => {
      const { orgId, userId } = await seedOrgAndUser("Adaptive Anonymous Org");
      const learner = await seedOrgAndUser("Adaptive Anonymous Learner Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
      const [objective] = await replaceObjectives(orgId, curriculum.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      // Even though THIS learner passed it, learnerId: null must never see it.
      await withAuthContext({ orgId }, (tx) =>
        tx.objectiveProgress.create({
          data: { orgId, objectiveId: objective!.id, learnerId: learner.userId, verdict: "PASS", attempts: 1, feedback: "Correct." },
        }),
      );

      const result = await getCurriculumForAvatar(orgId, avatarId, null);
      expect(result?.objectives[0]).toMatchObject({ status: "NOT_STARTED" });
    });

    it("does not leak one org's learner progress into another org's status for the same objective title/order", async () => {
      const orgA = await seedOrgAndUser("Adaptive Isolation Org A");
      const orgB = await seedOrgAndUser("Adaptive Isolation Org B");
      const learner = await seedOrgAndUser("Adaptive Isolation Learner Org");
      const avatarA = await seedAvatar(orgA.orgId, orgA.userId);
      const avatarB = await seedAvatar(orgB.orgId, orgB.userId);
      const curriculumA = await createCurriculum(orgA.orgId, orgA.userId, { avatarId: avatarA, title: "X" });
      const curriculumB = await createCurriculum(orgB.orgId, orgB.userId, { avatarId: avatarB, title: "X" });
      const [objectiveA] = await replaceObjectives(orgA.orgId, curriculumA.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      await replaceObjectives(orgB.orgId, curriculumB.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      await withAuthContext({ orgId: orgA.orgId }, (tx) =>
        tx.objectiveProgress.create({
          data: { orgId: orgA.orgId, objectiveId: objectiveA!.id, learnerId: learner.userId, verdict: "PASS", attempts: 1, feedback: "Correct." },
        }),
      );

      const resultB = await getCurriculumForAvatar(orgB.orgId, avatarB, learner.userId);
      expect(resultB?.objectives[0]).toMatchObject({ status: "NOT_STARTED" });
    });
  });

  describe("listCurriculumProgress", () => {
    it("returns each learner's verdict, attempts, and feedback with the objective title and learner email", async () => {
      const { orgId, userId } = await seedOrgAndUser("Progress Org");
      const learner = await seedOrgAndUser("Progress Learner Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
      const [objective] = await replaceObjectives(orgId, curriculum.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);

      await withAuthContext({ orgId }, (tx) =>
        tx.objectiveProgress.create({
          data: {
            orgId,
            objectiveId: objective!.id,
            learnerId: learner.userId,
            verdict: "PASS",
            attempts: 2,
            feedback: "Well done",
          },
        }),
      );

      const progress = await listCurriculumProgress(orgId, curriculum.id);
      expect(progress).toHaveLength(1);
      expect(progress[0]).toMatchObject({
        objectiveId: objective!.id,
        objectiveTitle: "Obj 1",
        learnerId: learner.userId,
        verdict: "PASS",
        attempts: 2,
        feedback: "Well done",
      });
      expect(progress[0]!.learnerEmail).toContain("Progress Learner Org");
    });

    it("404s for another org's curriculum", async () => {
      const orgA = await seedOrgAndUser("Progress NotFound Org A");
      const orgB = await seedOrgAndUser("Progress NotFound Org B");
      const avatarId = await seedAvatar(orgA.orgId, orgA.userId);
      const curriculum = await createCurriculum(orgA.orgId, orgA.userId, { avatarId, title: "X" });

      await expect(listCurriculumProgress(orgB.orgId, curriculum.id)).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
