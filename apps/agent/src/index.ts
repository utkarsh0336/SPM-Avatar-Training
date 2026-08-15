import { fileURLToPath } from "node:url";
import { cli, ServerOptions } from "@livekit/agents";
import { LIVEKIT_AGENT_NAME, createRedisConcurrencyCounter, createLogger, initSentry } from "@avatrain/shared";
import { loadAgentConfig } from "./config.js";
import { createMetricsServer } from "./metrics-server.js";

const config = loadAgentConfig();

// initSentry() is a true no-op when SENTRY_DSN is unset — safe with no env
// changes in local dev/CI. Both calls happen once at process start, never
// inside a per-turn handler (.claude/rules/realtime.md).
initSentry(config.SENTRY_DSN, { environment: process.env.NODE_ENV ?? "development" });
export const logger = createLogger("agent", config.LOG_LEVEL);

// One counter/server per Fly Machine (this process), independent of the
// per-job child processes @livekit/agents spawns below — see
// metrics-server.ts's doc comment for why every machine reporting the same
// fleet-wide count is expected, not a bug.
createMetricsServer({
  port: config.METRICS_PORT,
  workerCapacity: config.WORKER_CAPACITY,
  counter: createRedisConcurrencyCounter(),
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(new URL("./livekit-worker.js", import.meta.url)),
    agentName: config.LIVEKIT_AGENT_NAME || LIVEKIT_AGENT_NAME,
    wsURL: config.LIVEKIT_URL,
    apiKey: config.LIVEKIT_API_KEY,
    apiSecret: config.LIVEKIT_API_SECRET,
  }),
);
