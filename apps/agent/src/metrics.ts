import type { TeardownReason } from "./teardown.js";

export interface UsageEvent {
  trainingSessionId: string;
  orgId: string;
  roomName: string;
  billableMs: number;
  reason: TeardownReason | "cost_gate_timeout";
}

/**
 * Structured usage log line — no billing consumer exists yet (that's a
 * future Phase 7 concern per docs/ROADMAP.md), same "log it, don't invent a
 * consumer" posture apps/api/src/services/conversation-service.ts's own
 * `turn_latency` structured log already establishes for this codebase.
 */
export function emitUsage(event: UsageEvent): void {
  console.log(JSON.stringify({ event: "livekit_usage", ...event, at: new Date().toISOString() }));
}
