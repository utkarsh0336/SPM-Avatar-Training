import pino, { type Logger } from "pino";

/**
 * Every log line in this repo today is a raw console.* call — apps/api ran
 * Fastify({ logger: false }) and apps/agent had no logger at all before
 * this. `name` tags which process emitted a line (e.g. "api", "agent")
 * since both ship to the same log destination once deployed.
 */
export function createLogger(name: string, level: string = "info"): Logger {
  return pino({ name, level });
}
