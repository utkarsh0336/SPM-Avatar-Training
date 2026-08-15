import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { MAX_KNOWLEDGE_DOCUMENT_BYTES, initSentry } from "@avatrain/shared";
import { loadApiConfig } from "./config.js";
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
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerStatusRoutes } from "./routes/status.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { registerMetricsRoutes } from "./routes/metrics.js";

// Initialized once at module load, before buildApp() is ever called from
// index.ts (or from a test importing this module) — never inside a
// per-request handler. initSentry() is a true no-op when SENTRY_DSN is
// unset, so this is safe in local dev/CI with no config changes.
const config = loadApiConfig();
initSentry(config.SENTRY_DSN, { environment: process.env.NODE_ENV ?? "development" });

export function buildApp() {
  // Fastify constructs and owns its own internal Pino instance from this
  // options object rather than us passing one in directly — passing a raw
  // instance from packages/shared's createLogger() (used as-is by
  // apps/agent, a plain Node process with no Fastify involved) hits a real
  // Fastify<->pino type mismatch (FastifyBaseLogger vs pino's BaseLogger
  // disagree on `msgPrefix`) once threaded through withTypeProvider()'s
  // route() generics. `name` distinguishes this process's log lines from
  // apps/agent's once both ship to the same log destination.
  const app = Fastify({ logger: { name: "api", level: config.LOG_LEVEL } });

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
  registerAnalyticsRoutes(app);
  registerHealthRoutes(app);
  registerStatusRoutes(app);
  registerInternalRoutes(app);
  registerMetricsRoutes(app);

  app.get("/healthz", async () => ({ status: "ok" }));

  return app;
}
