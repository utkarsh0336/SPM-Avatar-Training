import { describe, expect, it } from "vitest";
import { runWorker } from "./worker.js";

describe("agent", () => {
  it("stub resolves until Phase 6 LiveKit wiring lands", async () => {
    await expect(runWorker()).resolves.toContain("Phase 6");
  });
});
