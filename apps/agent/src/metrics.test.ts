import { describe, expect, it, vi } from "vitest";
import { emitUsage } from "./metrics.js";

describe("emitUsage", () => {
  it("logs a single structured JSON line with the event name and every field", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    emitUsage({
      trainingSessionId: "s1",
      orgId: "org-1",
      roomName: "ts_s1",
      billableMs: 12345,
      reason: "idle_timeout",
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed).toMatchObject({
      event: "livekit_usage",
      trainingSessionId: "s1",
      orgId: "org-1",
      roomName: "ts_s1",
      billableMs: 12345,
      reason: "idle_timeout",
    });
    expect(typeof parsed.at).toBe("string");

    logSpy.mockRestore();
  });

  it("accepts cost_gate_timeout as a reason distinct from the three TeardownReason values", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    emitUsage({ trainingSessionId: "s1", orgId: "org-1", roomName: "ts_s1", billableMs: 0, reason: "cost_gate_timeout" });
    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed.reason).toBe("cost_gate_timeout");
    logSpy.mockRestore();
  });
});
