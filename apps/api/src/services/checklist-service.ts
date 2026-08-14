import {
  isUniqueConstraintError,
  withOrg,
  type ChecklistItemInput,
  type ChecklistItemResult,
  type ChecklistResult,
  type CreateChecklistRequest,
} from "@avatrain/shared";
import type { ChecklistItem, InductionChecklist } from "@prisma/client";
import { badRequest, conflict, notFound } from "../lib/http-errors.js";

function toChecklistItemResult(item: ChecklistItem, completed: boolean): ChecklistItemResult {
  return {
    id: item.id,
    order: item.order,
    title: item.title,
    description: item.description,
    completed,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function toChecklistResult(
  checklist: InductionChecklist,
  items: ChecklistItem[],
  completedItemIds: Set<string>,
): ChecklistResult {
  return {
    id: checklist.id,
    curriculumId: checklist.curriculumId,
    title: checklist.title,
    items: [...items]
      .sort((a, b) => a.order - b.order)
      .map((item) => toChecklistItemResult(item, completedItemIds.has(item.id))),
    createdAt: checklist.createdAt.toISOString(),
    updatedAt: checklist.updatedAt.toISOString(),
  };
}

/**
 * POST /v1/curricula/:curriculumId/checklist — OWNER-only (route-level
 * gate). 409s if this curriculum already has one, mirroring
 * curriculum-service.ts's createCurriculum's own avatar-uniqueness 409. See
 * .claude/specs/induction-checklist.md.
 */
export async function createChecklist(
  orgId: string,
  userId: string,
  curriculumId: string,
  input: CreateChecklistRequest,
): Promise<{ id: string; curriculumId: string; title: string }> {
  const curriculum = await withOrg(orgId, (tx) => tx.curriculum.findFirst({ where: { id: curriculumId, orgId } }));
  if (!curriculum) throw notFound("curriculum_not_found");

  try {
    const checklist = await withOrg(orgId, (tx) =>
      tx.inductionChecklist.create({
        data: { orgId, curriculumId, createdById: userId, title: input.title },
      }),
    );
    return { id: checklist.id, curriculumId: checklist.curriculumId, title: checklist.title };
  } catch (error) {
    if (isUniqueConstraintError(error)) throw conflict("checklist_exists", "this curriculum already has a checklist");
    throw error;
  }
}

/**
 * GET /v1/curricula/:curriculumId/checklist — OWNER or an authenticated
 * learner. `completed` is resolved for the CALLER's own identity only, via
 * ChecklistItemProgress — never another learner's completion state.
 */
export async function getChecklist(
  orgId: string,
  curriculumId: string,
  callerId: string,
): Promise<ChecklistResult> {
  const checklist = await withOrg(orgId, (tx) => tx.inductionChecklist.findFirst({ where: { curriculumId, orgId } }));
  if (!checklist) throw notFound("checklist_not_found");

  const [items, progress] = await Promise.all([
    withOrg(orgId, (tx) => tx.checklistItem.findMany({ where: { checklistId: checklist.id, orgId } })),
    withOrg(orgId, (tx) =>
      tx.checklistItemProgress.findMany({
        where: { orgId, learnerId: callerId, item: { checklistId: checklist.id }, completedAt: { not: null } },
      }),
    ),
  ]);

  return toChecklistResult(checklist, items, new Set(progress.map((p) => p.itemId)));
}

/**
 * PUT /v1/curricula/:curriculumId/checklist/items — OWNER-only. Replace-
 * the-whole-list semantics identical to curriculum-service.ts's
 * replaceObjectives: existing items with a matching id are updated in place
 * (preserving the id any ChecklistItemProgress rows reference), items
 * without one are created, items missing from the new list are deleted.
 * Same negative-order staging trick for the @@unique([checklistId, order])
 * constraint — see replaceObjectives' own doc comment for why.
 */
export async function replaceItems(
  orgId: string,
  curriculumId: string,
  items: ChecklistItemInput[],
): Promise<ChecklistItemResult[]> {
  return withOrg(orgId, async (tx) => {
    const checklist = await tx.inductionChecklist.findFirst({ where: { curriculumId, orgId } });
    if (!checklist) throw notFound("checklist_not_found");

    const existing = await tx.checklistItem.findMany({ where: { checklistId: checklist.id, orgId } });
    const existingIds = new Set(existing.map((i) => i.id));
    const incomingIds = new Set(items.flatMap((i) => (i.id ? [i.id] : [])));

    for (const item of items) {
      if (item.id && !existingIds.has(item.id)) {
        throw badRequest("checklist_item_not_found", `checklist item ${item.id} does not belong to this checklist`);
      }
    }

    const toDelete = existing.filter((i) => !incomingIds.has(i.id));
    if (toDelete.length > 0) {
      await tx.checklistItem.deleteMany({ where: { id: { in: toDelete.map((i) => i.id) } } });
    }

    const survivingExisting = existing.filter((i) => incomingIds.has(i.id));
    for (let i = 0; i < survivingExisting.length; i++) {
      await tx.checklistItem.update({ where: { id: survivingExisting[i]!.id }, data: { order: -(i + 1) } });
    }

    const saved: ChecklistItem[] = [];
    for (let index = 0; index < items.length; index++) {
      const input = items[index]!;
      const data = { order: index, title: input.title, description: input.description ?? null };
      saved.push(
        input.id
          ? await tx.checklistItem.update({ where: { id: input.id }, data })
          : await tx.checklistItem.create({ data: { ...data, orgId, checklistId: checklist.id } }),
      );
    }

    return saved.sort((a, b) => a.order - b.order).map((item) => toChecklistItemResult(item, false));
  });
}

/**
 * DELETE /v1/curricula/:curriculumId/checklist — OWNER-only. Items and
 * progress rows cascade via their FKs' ON DELETE CASCADE.
 */
export async function deleteChecklist(orgId: string, curriculumId: string): Promise<void> {
  const checklist = await withOrg(orgId, (tx) => tx.inductionChecklist.findFirst({ where: { curriculumId, orgId } }));
  if (!checklist) throw notFound("checklist_not_found");
  await withOrg(orgId, (tx) => tx.inductionChecklist.delete({ where: { id: checklist.id } }));
}

/**
 * PATCH /v1/checklist-items/:itemId/complete — authenticated learner.
 * Self-attested, not server-graded — no serverOnly tool-call machinery
 * needed (unlike record_progress). Upserts for the CALLER's own identity
 * only; learnerId is never accepted from the request body, mirroring
 * ObjectiveProgress's own trust boundary. completed: false clears
 * completedAt back to null rather than deleting the row.
 */
export async function completeItem(
  orgId: string,
  itemId: string,
  learnerId: string,
  completed: boolean,
): Promise<{ itemId: string; completed: boolean; completedAt: string | null }> {
  const item = await withOrg(orgId, (tx) => tx.checklistItem.findFirst({ where: { id: itemId, orgId } }));
  if (!item) throw notFound("checklist_item_not_found");

  const completedAt = completed ? new Date() : null;
  const progress = await withOrg(orgId, (tx) =>
    tx.checklistItemProgress.upsert({
      where: { itemId_learnerId: { itemId, learnerId } },
      create: { orgId, itemId, learnerId, completedAt },
      update: { completedAt },
    }),
  );

  return {
    itemId: progress.itemId,
    completed: progress.completedAt !== null,
    completedAt: progress.completedAt?.toISOString() ?? null,
  };
}
