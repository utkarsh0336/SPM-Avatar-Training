import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, setAuthContext, withAuthContext } from "@avatrain/shared";
import { createCurriculum } from "./curriculum-service.js";
import { completeItem, createChecklist, deleteChecklist, getChecklist, replaceItems } from "./checklist-service.js";

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const orgId of createdOrgIds) {
    await withAuthContext({ orgId }, async (tx) => {
      // InductionChecklist/ChecklistItem/ChecklistItemProgress cascade via curricula's FK ON DELETE CASCADE.
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

async function seedCurriculumId(orgId: string, userId: string): Promise<string> {
  const avatar = await withAuthContext({ orgId, userId }, (tx) =>
    tx.avatar.create({ data: { orgId, createdById: userId, name: "Test Avatar" } }),
  );
  const curriculum = await createCurriculum(orgId, userId, { avatarId: avatar.id, title: "X" });
  return curriculum.id;
}

async function seedLearner(orgId: string, label: string): Promise<string> {
  const userId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.user.create({ data: { id: userId, email: `${label}-${randomUUID()}@example.com`, passwordHash: "seeded" } });
    await setAuthContext(tx, { userId, orgId });
    await tx.membership.create({ data: { orgId, userId, role: "MEMBER" } });
  });
  createdUserIds.push(userId);
  return userId;
}

describe("checklist-service", () => {
  describe("createChecklist", () => {
    it("409s on a second create for the same curriculum", async () => {
      const { orgId, userId } = await seedOrgAndUser("Checklist Create Duplicate Org");
      const curriculumId = await seedCurriculumId(orgId, userId);

      await createChecklist(orgId, userId, curriculumId, { title: "First" });
      await expect(createChecklist(orgId, userId, curriculumId, { title: "Second" })).rejects.toMatchObject({
        statusCode: 409,
      });
    });
  });

  describe("replaceItems", () => {
    it("preserves an existing item's ChecklistItemProgress row when the item is edited, not recreated", async () => {
      const { orgId, userId } = await seedOrgAndUser("Checklist Replace Preserve Org");
      const curriculumId = await seedCurriculumId(orgId, userId);
      await createChecklist(orgId, userId, curriculumId, { title: "Induction" });

      const created = await replaceItems(orgId, curriculumId, [{ title: "Original" }]);
      const itemId = created[0]!.id;
      await completeItem(orgId, itemId, userId, true);

      const edited = await replaceItems(orgId, curriculumId, [{ id: itemId, title: "Edited Title" }]);
      expect(edited).toHaveLength(1);
      expect(edited[0]!.id).toBe(itemId);
      expect(edited[0]!.title).toBe("Edited Title");

      const checklist = await getChecklist(orgId, curriculumId, userId);
      expect(checklist.items[0]).toMatchObject({ id: itemId, completed: true });
    });

    it("400s for an id that does not belong to the checklist", async () => {
      const { orgId, userId } = await seedOrgAndUser("Checklist Replace Foreign Id Org");
      const curriculumId = await seedCurriculumId(orgId, userId);
      await createChecklist(orgId, userId, curriculumId, { title: "Induction" });

      await expect(
        replaceItems(orgId, curriculumId, [{ id: randomUUID(), title: "X" }]),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("deletes items missing from the new list", async () => {
      const { orgId, userId } = await seedOrgAndUser("Checklist Replace Delete Org");
      const curriculumId = await seedCurriculumId(orgId, userId);
      await createChecklist(orgId, userId, curriculumId, { title: "Induction" });

      await replaceItems(orgId, curriculumId, [{ title: "A" }, { title: "B" }]);
      const replaced = await replaceItems(orgId, curriculumId, [{ title: "C" }]);
      expect(replaced).toHaveLength(1);
      expect(replaced[0]!.title).toBe("C");
    });
  });

  describe("completeItem", () => {
    it("upserts: create on first call, flips completedAt on the next", async () => {
      const { orgId, userId } = await seedOrgAndUser("Checklist Complete Upsert Org");
      const curriculumId = await seedCurriculumId(orgId, userId);
      await createChecklist(orgId, userId, curriculumId, { title: "Induction" });
      const [item] = await replaceItems(orgId, curriculumId, [{ title: "X" }]);

      const first = await completeItem(orgId, item!.id, userId, true);
      expect(first.completed).toBe(true);
      expect(first.completedAt).not.toBeNull();

      const second = await completeItem(orgId, item!.id, userId, false);
      expect(second.completed).toBe(false);
      expect(second.completedAt).toBeNull();
    });

    it("is independent per learner", async () => {
      const { orgId, userId } = await seedOrgAndUser("Checklist Complete Per Learner Org");
      const learnerB = await seedLearner(orgId, "learner-b");
      const curriculumId = await seedCurriculumId(orgId, userId);
      await createChecklist(orgId, userId, curriculumId, { title: "Induction" });
      const [item] = await replaceItems(orgId, curriculumId, [{ title: "X" }]);

      await completeItem(orgId, item!.id, userId, true);

      const checklistForOwner = await getChecklist(orgId, curriculumId, userId);
      const checklistForLearnerB = await getChecklist(orgId, curriculumId, learnerB);
      expect(checklistForOwner.items[0]!.completed).toBe(true);
      expect(checklistForLearnerB.items[0]!.completed).toBe(false);
    });
  });

  describe("deleteChecklist", () => {
    it("404s a later getChecklist call", async () => {
      const { orgId, userId } = await seedOrgAndUser("Checklist Delete Org");
      const curriculumId = await seedCurriculumId(orgId, userId);
      await createChecklist(orgId, userId, curriculumId, { title: "Induction" });

      await deleteChecklist(orgId, curriculumId);

      await expect(getChecklist(orgId, curriculumId, userId)).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
