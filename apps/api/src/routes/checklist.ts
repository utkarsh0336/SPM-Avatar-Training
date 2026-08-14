import type { FastifyInstance } from "fastify";
import {
  checklistItemIdParamSchema,
  completeChecklistItemRequestSchema,
  createChecklistRequestSchema,
  curriculumIdParamSchema,
  replaceChecklistItemsRequestSchema,
} from "@avatrain/shared";
import { requireRole } from "../plugins/auth.js";
import * as checklistService from "../services/checklist-service.js";

/**
 * Induction checklist authoring/completion — SOW §3.4, see
 * .claude/specs/induction-checklist.md. Kept as its own route file rather
 * than folded into curriculum.ts, same reasoning progress reads live
 * alongside but separate from curriculum authoring there. Authoring
 * (create/replace-items/delete) is OWNER-only, mirroring curriculum.ts's
 * writeGate. Reads (GET checklist, complete an item) are any authenticated
 * org member — completion is self-attested per-caller, not graded, so it
 * doesn't need OWNER-only or the serverOnly tool-call machinery
 * record_progress uses. orgId/userId always come from request.authContext,
 * never the request body/params.
 */
export function registerChecklistRoutes(app: FastifyInstance): void {
  const writeGate = { preHandler: [app.authenticate, requireRole("OWNER")] };
  const readGate = { preHandler: [app.authenticate] };

  app.post("/v1/curricula/:curriculumId/checklist", writeGate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    const input = createChecklistRequestSchema.parse(request.body);
    const result = await checklistService.createChecklist(
      request.authContext!.orgId,
      request.authContext!.userId,
      curriculumId,
      input,
    );
    reply.status(201).send(result);
  });

  app.get("/v1/curricula/:curriculumId/checklist", readGate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    const result = await checklistService.getChecklist(
      request.authContext!.orgId,
      curriculumId,
      request.authContext!.userId,
    );
    reply.status(200).send(result);
  });

  app.put("/v1/curricula/:curriculumId/checklist/items", writeGate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    const { items } = replaceChecklistItemsRequestSchema.parse(request.body);
    const saved = await checklistService.replaceItems(request.authContext!.orgId, curriculumId, items);
    reply.status(200).send({ items: saved });
  });

  app.delete("/v1/curricula/:curriculumId/checklist", writeGate, async (request, reply) => {
    const { curriculumId } = curriculumIdParamSchema.parse(request.params);
    await checklistService.deleteChecklist(request.authContext!.orgId, curriculumId);
    reply.status(204).send();
  });

  app.patch("/v1/checklist-items/:itemId/complete", readGate, async (request, reply) => {
    const { itemId } = checklistItemIdParamSchema.parse(request.params);
    const { completed } = completeChecklistItemRequestSchema.parse(request.body);
    const result = await checklistService.completeItem(
      request.authContext!.orgId,
      itemId,
      request.authContext!.userId,
      completed,
    );
    reply.status(200).send(result);
  });
}
