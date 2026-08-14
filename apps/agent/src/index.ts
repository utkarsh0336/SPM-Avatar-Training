import { fileURLToPath } from "node:url";
import { cli, ServerOptions } from "@livekit/agents";
import { LIVEKIT_AGENT_NAME } from "@avatrain/shared";
import { loadAgentConfig } from "./config.js";

const config = loadAgentConfig();

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(new URL("./livekit-worker.js", import.meta.url)),
    agentName: config.LIVEKIT_AGENT_NAME || LIVEKIT_AGENT_NAME,
    wsURL: config.LIVEKIT_URL,
    apiKey: config.LIVEKIT_API_KEY,
    apiSecret: config.LIVEKIT_API_SECRET,
  }),
);
