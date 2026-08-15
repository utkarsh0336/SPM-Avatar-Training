import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { MAX_KNOWLEDGE_DOCUMENT_BYTES } from "@avatrain/shared";
import { handleError } from "./lib/http-errors.js";
import { registerAuthPlugin } from "./plugins/auth.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerOnboardingRoutes } from "./routes/onboarding.js";
import { registerOrgRoutes } from "./routes/org.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
import { registerCurriculumRoutes } from "./routes/curriculum.js";
import { registerTrainingSessionRoutes } from "./routes/training-sessions.js";
import { registerChecklistRoutes } from "./routes/checklist.js";
import { registerScenarioRoutes } from "./routes/scenario.js";
import { registerAvatarRoutes } from "./routes/avatars.js";
import { registerApplicationRoutes } from "./routes/applications.js";
import { registerEmbedRoutes } from "./routes/embed.js";

export function buildApp() {
  const app = Fastify({ logger: false });

  app.setErrorHandler(handleError);
  // Must be registered before any route it should intercept — see
  // @fastify/websocket's README "NB" section. Registration itself is
  // async (avvio boot queue), so routes with `websocket: true` must wait
  // for it via app.after() — declaring them synchronously right after
  // app.register() runs before the plugin's onRoute hook is wired up,
  // silently leaving those routes as plain (request, reply) handlers that
  // crash with "socket.on is not a function" on first real connection.
  app.register(websocket);
  app.after(() => {
    registerConversationRoutes(app);
  });
  // Own limit matches MAX_KNOWLEDGE_DOCUMENT_BYTES — @fastify/multipart's
  // own default (1MB) would otherwise silently truncate uploads well under
  // knowledge-service.ts's own size-cap check.
  app.register(multipart, { limits: { fileSize: MAX_KNOWLEDGE_DOCUMENT_BYTES } });
  registerAuthPlugin(app);
  registerAuthRoutes(app);
  registerOnboardingRoutes(app);
  registerOrgRoutes(app);
  registerKnowledgeRoutes(app);
  registerCurriculumRoutes(app);
  registerTrainingSessionRoutes(app);
  registerChecklistRoutes(app);
  registerScenarioRoutes(app);
  registerAvatarRoutes(app);
  registerApplicationRoutes(app);
  registerEmbedRoutes(app);

  app.get("/healthz", async () => ({ status: "ok" }));

  return app;
}
