import { describe, expect, it } from "vitest";
import { embedInboundMessageSchema } from "@avatrain/shared/contracts";
import { parseInboundMessage } from "./index.js";

/**
 * This package ships zero runtime dependencies (10KB gzip budget, see
 * .claude/rules/embed.md), so parseInboundMessage is a hand-rolled
 * validator, not zod. @avatrain/shared is a devDependency ONLY (test-only —
 * never imported by index.ts, never bundled into dist/index.js, so it
 * doesn't count against the runtime budget check.mjs enforces). This test
 * asserts the hand-rolled parser accepts and rejects the exact same inputs
 * as the zod-authoritative embedInboundMessageSchema — the two must never
 * silently drift apart.
 */
const CASES: unknown[] = [
  { type: "avatrain:ready" },
  { type: "avatrain:resize", height: 620 },
  { type: "avatrain:resize", height: 0 },
  { type: "avatrain:resize", height: -10 },
  { type: "avatrain:resize", height: "620" },
  { type: "avatrain:resize", height: Number.NaN },
  { type: "avatrain:resize" },
  { type: "something-else" },
  { height: 500 },
  null,
  undefined,
  "avatrain:ready",
  42,
  [],
  {},
];

describe("parseInboundMessage / embedInboundMessageSchema parity", () => {
  for (const input of CASES) {
    it(`agree on ${JSON.stringify(input)}`, () => {
      const handRolledAccepted = parseInboundMessage(input) !== null;
      const zodAccepted = embedInboundMessageSchema.safeParse(input).success;
      expect(handRolledAccepted).toBe(zodAccepted);
    });
  }
});
