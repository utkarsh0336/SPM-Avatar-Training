import { preloadLocalEmbeddingModel } from "@avatrain/shared";
import { installOutboundRequestGuard } from "./lib/outbound-request-guard.js";
import { buildApp } from "./app.js";

// Must run before any provider is constructed — providers cache the global
// fetch reference at construction time, and construction is lazy (per WS
// connection, on session.start), which always happens after this line runs.
installOutboundRequestGuard();

// Warms the default local embedding model ahead of the first real request —
// left to lazy-load on the request path, the first retrieval-eligible turn
// on a freshly booted process pays a cold ONNX fetch+decode (~90MB) inline
// inside retrieveContext(), which reliably blows the retrieval timeout and
// silently ungrounds that turn. See docs/ARCHITECTURE.md §5's <100ms p95
// retrieval budget and .claude/specs/knowledge-management.md. A no-op
// (never awaited, fire-and-forget) when EMBEDDING_PROVIDER=openai is set
// instead — that adapter has no local model to warm.
if ((process.env.EMBEDDING_PROVIDER ?? "local") === "local") {
  void preloadLocalEmbeddingModel().catch((err) => {
    console.error("failed to preload local embedding model", err);
  });
}

const app = buildApp();
const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  console.error(err);
  process.exit(1);
});
