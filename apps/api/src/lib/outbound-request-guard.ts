/**
 * Opt-in outbound-fetch logger (LOG_OUTBOUND_REQUESTS=true, off by default)
 * for the brief's $0-constraint DoD check: "With default env settings, a
 * full session makes zero calls to any paid endpoint. Verify from the
 * request log, not from reading the code." Wraps the global fetch once at
 * boot — every LLM/STT provider adapter defaults its injectable `fetchImpl`
 * to the global `fetch`, captured at provider-construction time, so this
 * MUST be installed before any provider is constructed (apps/api/src/index.ts
 * calls this before buildApp()'s route/service module graph — which
 * constructs providers lazily per WS connection, not at import time — ever
 * runs, not after).
 *
 * Known gap, not fixed here: this only observes calls that actually go
 * through globalThis.fetch. echogarden's voice-model downloads and
 * msedge-tts's connection to Microsoft's edge endpoint do not necessarily
 * go through fetch (echogarden uses its own HTTP client internally;
 * msedge-tts is WebSocket-based) — this guard cannot vouch for those. Both
 * are free/non-paid by design regardless, so this does not threaten the $0
 * constraint, but it means this log is not a complete network trace.
 */
let installed = false;

export function installOutboundRequestGuard(env: NodeJS.ProcessEnv = process.env): void {
  if (installed || env.LOG_OUTBOUND_REQUESTS !== "true") return;
  installed = true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      console.log(
        JSON.stringify({ event: "outbound_request", host: new URL(url).host, at: new Date().toISOString() }),
      );
    } catch {
      // Malformed URL or similar — don't let logging itself break the real request.
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
