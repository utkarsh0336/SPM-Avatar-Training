import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { handleError } from "./lib/http-errors.js";
import { registerAuthPlugin } from "./plugins/auth.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerOnboardingRoutes } from "./routes/onboarding.js";
import { registerOrgRoutes } from "./routes/org.js";

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
  registerAuthPlugin(app);
  registerAuthRoutes(app);
  registerOnboardingRoutes(app);
  registerOrgRoutes(app);

  app.get("/healthz", async () => ({ status: "ok" }));

  return app;
}
