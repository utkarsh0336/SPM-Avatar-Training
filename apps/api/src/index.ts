import { installOutboundRequestGuard } from "./lib/outbound-request-guard.js";
import { buildApp } from "./app.js";

// Must run before any provider is constructed — providers cache the global
// fetch reference at construction time, and construction is lazy (per WS
// connection, on session.start), which always happens after this line runs.
installOutboundRequestGuard();

const app = buildApp();
const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  console.error(err);
  process.exit(1);
});
