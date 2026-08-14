import { describe, expect, it } from "vitest";
import { en } from "./en";
import { hi } from "./hi";

// Flattens nested keys to dot-paths ("settingsPage.title") so a missing leaf
// anywhere in the tree is caught, not just a missing top-level namespace.
function flattenKeys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null ? flattenKeys(value, path) : [path];
  });
}

describe("locale dictionary parity", () => {
  it("hi.ts exports exactly the same keys as en.ts", () => {
    const enKeys = flattenKeys(en).sort();
    const hiKeys = flattenKeys(hi).sort();

    // Two separate assertions (not one deep-equal) so a failure names
    // exactly which keys are missing/extra instead of just "not equal".
    expect(hiKeys, "hi.ts is missing keys present in en.ts").toEqual(
      expect.arrayContaining(enKeys),
    );
    expect(enKeys, "hi.ts has extra keys not present in en.ts").toEqual(
      expect.arrayContaining(hiKeys),
    );
  });
});
