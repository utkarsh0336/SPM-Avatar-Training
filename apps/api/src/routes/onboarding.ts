import type { FastifyInstance } from "fastify";
import { onboardingDraftSchema } from "@avatrain/shared";
import * as onboardingService from "../services/onboarding-service.js";

export function registerOnboardingRoutes(app: FastifyInstance): void {
  app.get("/v1/onboarding", { preHandler: app.authenticate }, async (request, reply) => {
    const { orgId, userId } = request.authContext!;
    const draft = await onboardingService.getOrCreateDraft(orgId, userId);
    reply.status(200).send(draft);
  });

  app.patch("/v1/onboarding", { preHandler: app.authenticate }, async (request, reply) => {
    const { orgId, userId } = request.authContext!;
    const patch = onboardingDraftSchema.parse(request.body);
    const draft = await onboardingService.updateDraft(orgId, userId, patch);
    reply.status(200).send(draft);
  });

  app.post("/v1/onboarding/complete", { preHandler: app.authenticate }, async (request, reply) => {
    const { orgId, userId } = request.authContext!;
    const result = await onboardingService.completeDraft(orgId, userId);
    reply.status(200).send(result);
  });
}
