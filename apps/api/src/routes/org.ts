import type { FastifyInstance } from "fastify";
import { orgBrandingUpdateSchema } from "@avatrain/shared";
import { requireRole } from "../plugins/auth.js";
import * as orgService from "../services/org-service.js";

export function registerOrgRoutes(app: FastifyInstance): void {
  app.patch(
    "/v1/org/branding",
    { preHandler: [app.authenticate, requireRole("OWNER")] },
    async (request, reply) => {
      const input = orgBrandingUpdateSchema.parse(request.body);
      // orgId always comes from the authenticated caller's session, never
      // the request body — an OWNER can only ever brand their own org. See
      // .claude/specs/tenant-branding.md's Implementation Rules.
      const result = await orgService.updateBranding(request.authContext!.orgId, input);
      reply.status(200).send(result);
    },
  );
}
