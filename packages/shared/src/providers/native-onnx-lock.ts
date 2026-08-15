// onnxruntime-node's native addon is not safe to call concurrently across
// INDEPENDENT InferenceSession instances in the same process — not just
// within one model. This codebase has two unrelated consumers that both end
// up calling onnxruntime-node's native Run()/session-load path on apps/api's
// realtime turn path: tts-echogarden.ts (a fresh VITS session per sentence)
// and embedding-local.ts (retrieval-service.ts's per-turn query embedding,
// via @xenova/transformers' shared MiniLM pipeline). Serializing each of
// those two consumers against *itself* is not enough: a live crash
// (SIGBUS/EXC_BAD_ACCESS in onnxruntime::InferenceSession::Run, captured via
// macOS crash report) reproduced from an embedding call and a TTS call
// overlapping across two turns — normal under real multi-tenant load, since
// apps/api is one process serving many concurrent orgs/sessions. Every
// native-ONNX call in the process must funnel through this single
// module-scope queue, or the lock doesn't actually cover the risk it exists
// for.
let nativeOnnxQueue: Promise<void> = Promise.resolve();

export function runNativeOnnxSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = nativeOnnxQueue.then(fn, fn);
  nativeOnnxQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
