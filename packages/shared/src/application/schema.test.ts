import { describe, expect, it } from "vitest";
import {
  applicationIdParamSchema,
  applicationRecordSchema,
  createApplicationRequestSchema,
  originSchema,
  updateApplicationRequestSchema,
} from "./schema.js";

describe("originSchema", () => {
  it("accepts a plain https origin", () => {
    expect(originSchema.safeParse("https://example.com").success).toBe(true);
  });

  it("accepts an origin with a port", () => {
    expect(originSchema.safeParse("http://localhost:3000").success).toBe(true);
  });

  it("rejects an origin with a path", () => {
    expect(originSchema.safeParse("https://example.com/widget").success).toBe(false);
  });

  it("rejects an origin with a trailing slash", () => {
    expect(originSchema.safeParse("https://example.com/").success).toBe(false);
  });

  it("rejects a wildcard", () => {
    expect(originSchema.safeParse("*").success).toBe(false);
  });
});

describe("applicationIdParamSchema", () => {
  it("accepts a valid uuid", () => {
    expect(applicationIdParamSchema.safeParse({ applicationId: "6e1b6f0a-7f0e-4c1b-9e6a-1e3a2b4c5d6e" }).success).toBe(
      true,
    );
  });
});

describe("applicationRecordSchema", () => {
  const record = {
    id: "6e1b6f0a-7f0e-4c1b-9e6a-1e3a2b4c5d6e",
    name: "Marketing Site Widget",
    publishableKey: "pk_abc123",
    allowedOrigins: ["https://example.com"],
    avatarId: null,
    isEnabled: true,
  };

  it("accepts a fully-populated record", () => {
    expect(applicationRecordSchema.safeParse(record).success).toBe(true);
  });

  it("accepts an empty allowedOrigins list", () => {
    expect(applicationRecordSchema.safeParse({ ...record, allowedOrigins: [] }).success).toBe(true);
  });

  it("rejects a bad origin in the list", () => {
    expect(applicationRecordSchema.safeParse({ ...record, allowedOrigins: ["not-a-url"] }).success).toBe(false);
  });
});

describe("createApplicationRequestSchema", () => {
  it("requires a non-empty name", () => {
    expect(createApplicationRequestSchema.safeParse({ name: "My Widget" }).success).toBe(true);
    expect(createApplicationRequestSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createApplicationRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("updateApplicationRequestSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateApplicationRequestSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a partial patch with just allowedOrigins", () => {
    expect(
      updateApplicationRequestSchema.safeParse({ allowedOrigins: ["https://a.com", "https://b.com"] }).success,
    ).toBe(true);
  });

  it("accepts clearing avatarId back to null", () => {
    expect(updateApplicationRequestSchema.safeParse({ avatarId: null }).success).toBe(true);
  });

  it("caps allowedOrigins at 20 entries", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `https://site-${i}.com`);
    expect(updateApplicationRequestSchema.safeParse({ allowedOrigins: tooMany }).success).toBe(false);
  });
});
