import { describe, expect, it } from "vitest";
import { emailSchema, passwordSchema, signupSchema, loginSchema, uiLocaleUpdateSchema } from "./schemas.js";

describe("emailSchema", () => {
  it("lowercases the email", () => {
    expect(emailSchema.parse("USER@Example.COM")).toBe("user@example.com");
  });

  it("rejects an invalid email", () => {
    expect(() => emailSchema.parse("not-an-email")).toThrow();
  });
});

describe("passwordSchema", () => {
  it("rejects a password under 8 characters", () => {
    expect(() => passwordSchema.parse("short1")).toThrow();
  });

  it("accepts an 8+ character password", () => {
    expect(passwordSchema.parse("password123")).toBe("password123");
  });
});

describe("signupSchema", () => {
  it("accepts a valid signup payload", () => {
    const result = signupSchema.parse({
      orgName: "Acme",
      email: "Owner@Acme.com",
      password: "password123",
    });
    expect(result.email).toBe("owner@acme.com");
  });
});

describe("loginSchema", () => {
  it("allows any non-empty password (weak-password check is signup-only)", () => {
    expect(() => loginSchema.parse({ email: "a@b.com", password: "x" })).not.toThrow();
  });

  it("rejects an empty password", () => {
    expect(() => loginSchema.parse({ email: "a@b.com", password: "" })).toThrow();
  });
});

describe("uiLocaleUpdateSchema", () => {
  it("accepts EN and HI", () => {
    expect(uiLocaleUpdateSchema.parse({ uiLocale: "EN" })).toEqual({ uiLocale: "EN" });
    expect(uiLocaleUpdateSchema.parse({ uiLocale: "HI" })).toEqual({ uiLocale: "HI" });
  });

  it("rejects any other value", () => {
    expect(() => uiLocaleUpdateSchema.parse({ uiLocale: "FR" })).toThrow();
    expect(() => uiLocaleUpdateSchema.parse({ uiLocale: "english" })).toThrow();
  });

  it("rejects a missing uiLocale", () => {
    expect(() => uiLocaleUpdateSchema.parse({})).toThrow();
  });
});
