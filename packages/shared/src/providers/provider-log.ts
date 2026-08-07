/**
 * One structured JSON log line per provider call — the brief's "log every
 * provider call with latency and which provider served it" (§8) plus the
 * failover DoD's "the log line for each turn names which provider actually
 * served it". apps/api runs Fastify({logger:false}), so this is the only
 * place these events are recorded; a full pino logger swap is out of scope.
 */
export type ProviderHop = "llm" | "stt" | "tts";
export type ProviderLogPhase = "served" | "failed";

export interface ProviderLogEntry {
  hop: ProviderHop;
  provider: string;
  phase: ProviderLogPhase;
  turnId?: string;
  errorKind?: string;
  durationMs?: number;
}

export function logProviderEvent(entry: ProviderLogEntry): void {
  console.log(JSON.stringify({ event: "provider_call", ...entry, at: new Date().toISOString() }));
}
