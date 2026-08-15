import { describe, expect, it } from "vitest";
import { redact } from "./redact.js";

describe("redact", () => {
  describe("email", () => {
    it("redacts an email address, preserving surrounding text", () => {
      expect(redact("Hello there, my email is foo@example.com, thanks!")).toBe(
        "Hello there, my email is [REDACTED_EMAIL], thanks!",
      );
    });

    it("does not redact a bare @-mention with no domain/TLD", () => {
      expect(redact("the handle is @foo, not an email")).toBe("the handle is @foo, not an email");
    });
  });

  describe("SSN", () => {
    it("redacts a dashed SSN", () => {
      expect(redact("my ssn is 123-45-6789 on file")).toBe("my ssn is [REDACTED_SSN] on file");
    });

    it("does not redact a bare 9-digit number with no dashes", () => {
      expect(redact("the order number is 123456789")).toBe("the order number is 123456789");
    });
  });

  describe("phone", () => {
    it("redacts a parenthesized US phone number", () => {
      expect(redact("call me at (415) 555-2671 tomorrow")).toBe("call me at [REDACTED_PHONE] tomorrow");
    });

    it("redacts a dashed phone number with country code", () => {
      expect(redact("reach us at +1-415-555-2671")).toBe("reach us at [REDACTED_PHONE]");
    });

    it("does not redact a short, non-phone-shaped number", () => {
      expect(redact("the code is 12345678")).toBe("the code is 12345678");
    });
  });

  describe("credit card", () => {
    it("redacts a Luhn-valid card number", () => {
      expect(redact("card number 4111111111111111 on file")).toBe("card number [REDACTED_CARD] on file");
    });

    it("does not redact a card-shaped but Luhn-invalid number", () => {
      // 16 digits, correct length for a card, but fails the Luhn checksum — should be treated as
      // an ordinary long number (e.g. an ID), not PII.
      expect(redact("reference 1111111111111111 was issued")).toBe("reference 1111111111111111 was issued");
    });
  });

  describe("multiple matches and pattern interaction", () => {
    it("redacts more than one PII instance in the same string", () => {
      expect(redact("email a@b.com or call (415) 555-2671")).toBe(
        "email [REDACTED_EMAIL] or call [REDACTED_PHONE]",
      );
    });

    it("is idempotent — redacting already-redacted text is a no-op", () => {
      const once = redact("contact a@b.com or 123-45-6789");
      expect(redact(once)).toBe(once);
    });
  });

  describe("robustness", () => {
    it("never throws on empty, unicode, or control-character input", () => {
      for (const input of ["", "😀🎉 emoji only", "\x00\x01\x02 control chars", "a".repeat(50_000)]) {
        expect(() => redact(input)).not.toThrow();
        expect(typeof redact(input)).toBe("string");
      }
    });

    it("completes in bounded time on adversarial near-match input (ReDoS safety)", () => {
      const adversarial = [
        `${"a".repeat(20_000)}@${"a".repeat(20_000)}`, // long email-like prefix, never completes a match
        `${"1".repeat(20_000)}`, // long digit run, exercises the bounded {13,19} credit-card pattern repeatedly
        `${"1-".repeat(20_000)}`, // long separator-heavy digit run
      ];
      for (const input of adversarial) {
        const start = Date.now();
        redact(input);
        expect(Date.now() - start).toBeLessThan(1_000);
      }
    });
  });
});
