import type { FastifyInstance } from "fastify";
import { applicationIdParamSchema, createApplicationRequestSchema, updateApplicationRequestSchema } from "@avatrain/shared";
import { requireRole } from "../plugins/auth.js";
import * as applicationService from "../services/application-service.js";

/**
 * OWNER-only, cookie-authenticated CRUD for Application (embed
 * configuration) — the dashboard's Embed Settings page. Deliberately a
 * separate file from routes/embed.ts, which is the public,
 * publishable-key-authenticated surface these rows drive — a fundamentally
 * different trust model, not just a different route prefix.
 */
export function registerApplicationRoutes(app: FastifyInstance): void {
  app.get("/v1/applications", { preHandler: [app.authenticate, requireRole("OWNER")] }, async (request, reply) => {
    const applications = await applicationService.listApplications(request.authContext!.orgId);
    reply.status(200).send({ applications });
  });

  app.post("/v1/applications", { preHandler: [app.authenticate, requireRole("OWNER")] }, async (request, reply) => {
    const { name } = createApplicationRequestSchema.parse(request.body);
    const application = await applicationService.createApplication(request.authContext!.orgId, name);
    reply.status(201).send({ application });
  });

  app.patch(
    "/v1/applications/:applicationId",
    { preHandler: [app.authenticate, requireRole("OWNER")] },
    async (request, reply) => {
      const { applicationId } = applicationIdParamSchema.parse(request.params);
      const patch = updateApplicationRequestSchema.parse(request.body);
      const application = await applicationService.updateApplication(request.authContext!.orgId, applicationId, patch);
      reply.status(200).send({ application });
    },
  );

  app.delete(
    "/v1/applications/:applicationId",
    { preHandler: [app.authenticate, requireRole("OWNER")] },
    async (request, reply) => {
      const { applicationId } = applicationIdParamSchema.parse(request.params);
      await applicationService.deleteApplication(request.authContext!.orgId, applicationId);
      reply.status(204).send();
    },
  );
}
