import Fastify from "fastify";
import { handleError } from "./lib/http-errors.js";
import { registerAuthPlugin } from "./plugins/auth.js";
import { registerAuthRoutes } from "./routes/auth.js";

export function buildApp() {
  const app = Fastify({ logger: false });

  app.setErrorHandler(handleError);
  registerAuthPlugin(app);
  registerAuthRoutes(app);

  app.get("/healthz", async () => ({ status: "ok" }));

  return app;
}
