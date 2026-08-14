import { preloadLocalEmbeddingModel } from "@avatrain/shared";
import { installOutboundRequestGuard } from "./lib/outbound-request-guard.js";
import { createIngestionWorker } from "./lib/ingestion-queue.js";
import { ingestStoredDocument } from "./services/knowledge-service.js";

// Same ordering reasoning as index.ts: must run before any provider is
// constructed, which here happens lazily inside ingestStoredDocument() on
// the first job, not at import time.
installOutboundRequestGuard();

// Same reasoning as index.ts: avoid a cold-start ONNX load (~90MB) stalling
// the first real ingestion job. No-op when EMBEDDING_PROVIDER=openai.
if ((process.env.EMBEDDING_PROVIDER ?? "local") === "local") {
  void preloadLocalEmbeddingModel().catch((err) => {
    console.error("worker: failed to preload local embedding model", err);
  });
}

const worker = createIngestionWorker(
  async ({ orgId, documentId }) => {
    await ingestStoredDocument(orgId, documentId);
  },
  { concurrency: Number(process.env.INGESTION_WORKER_CONCURRENCY ?? 2) },
);

console.log("worker: listening for knowledge-ingestion jobs");

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`worker: received ${signal}, closing`);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
