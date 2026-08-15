/**
 * PII redaction applied at write time (before insert), never on read — see
 * .claude/rules/tenancy.md. Called synchronously and inline from
 * apps/api/src/services/training-session-service.ts's persistTrainingSessionMessage, itself
 * fire-and-forget directly on the WS realtime hot path — so this must stay pure regex (no I/O, no
 * async work) and must never throw. See .claude/specs/pii-redaction.md.
 *
 * v1 scope is high-confidence *structured* PII only: email addresses, SSN-shaped numbers, phone
 * numbers, and credit-card-shaped numbers (Luhn-validated to cut false positives on generic long
 * numbers). Free-text entities (names, addresses) need NER, not regex, and are an explicit
 * non-goal — see the spec's Explicit Non-Goals.
 *
 * All patterns use only bounded/fixed-count quantifiers (no nested or overlapping unbounded
 * groups) — this runs on every persisted turn against STT-transcribed, attacker-influenced text,
 * so a catastrophic-backtracking (ReDoS) pattern here would be a real availability bug, not just a
 * theoretical one. Keep any new pattern to that same shape.
 */

// Bounded, not unbounded (+), quantifiers on the local-part/domain groups — this is the one
// pattern here without a leading anchor, and on adversarial input with no real "@"/"." to find
// (e.g. a long run of digits, or "a".repeat(N) + "@" + "a".repeat(N) with no TLD), an unbounded
// `+` on both sides of "@" backtracks all the way down to length 1 at *every* one of the O(n)
// possible starting positions — O(n) work per position × O(n) positions = O(n²), a real
// quadratic-blowup DoS vector on this hot path, not just a theoretical one (caught by this file's
// own ReDoS test). Capping each group's length (64/255/24, generous relative to RFC 5321's actual
// local-part/domain limits) bounds the backtrack range to a small constant per position, making
// the whole match O(n) regardless of input.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,24}/g;

// Canonical dashed format only (###-##-####), not a bare 9-digit run — a bare 9-digit number is
// common in non-PII contexts (order numbers, part numbers) in training content, so matching it
// unconditionally would over-redact legitimate material for low marginal PII coverage.
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

// Optional US country code, optional parens/separators, fixed 3-3-4 digit groups. The leading/
// trailing "not adjacent to another digit" guards matter more than they look: without them, this
// pattern can match a 10/11-digit *tail* carved out of a longer digit run (e.g. the last 10 digits
// of a 16-digit card number), stealing it away before CREDIT_CARD_CANDIDATE_PATTERN's Luhn check
// ever gets a chance to run. Lookaround (not \b) is required here specifically because the match
// can start on a non-word character ("(" or "+") — a plain leading \b would fail right before
// those (space→"(" is non-word-to-non-word, never a boundary), which would drop the "(" from a
// "(415) 555-2671"-shaped match.
const PHONE_PATTERN = /(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/g;

// Broadest pattern, deliberately run last (see redact() below) so it only ever sees digit runs
// the more specific SSN/phone patterns didn't already consume. {12,18} (on top of the one
// mandatory leading \d) is a bounded repetition count, not unbounded — safe from catastrophic
// backtracking. Luhn-checked below before being treated as a real match, since an arbitrary
// 13-19 digit run (an ID number, a long order number) is far more common than an actual card
// number and would otherwise be a heavy false-positive source.
//
// Structured as "digit, then (optional separator + digit) repeated" rather than "(digit + optional
// separator) repeated" deliberately: the latter lets the final repetition's optional separator
// consume a trailing space/dash that was never part of the number (e.g. swallowing the space in
// "1234567890123456 on file"), since the engine doesn't know it's on the last digit until after
// the fact. Ending every possible match on a mandatory \d rules that out structurally.
const CREDIT_CARD_CANDIDATE_PATTERN = /\b\d(?:[ -]?\d){12,18}\b/g;

/** Standard Luhn checksum — real card numbers satisfy this; most random long digit runs don't. */
function passesLuhnCheck(digitsOnly: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digitsOnly.length - 1; i >= 0; i--) {
    let digit = Number(digitsOnly[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return digitsOnly.length > 0 && sum % 10 === 0;
}

/**
 * Never throws — on any internal fault, fails open (returns the original text) rather than
 * blocking the turn or destroying legitimate content. This is a deliberate trade-off, not an
 * oversight: the opposite choice (fail closed / replace-with-placeholder-on-error) would mean a
 * redaction bug destroys real transcript content, which is worse than this function's existing
 * baseline. See .claude/specs/pii-redaction.md's Implementation Rules.
 */
export function redact(text: string): string {
  try {
    let result = text;
    result = result.replace(EMAIL_PATTERN, "[REDACTED_EMAIL]");
    result = result.replace(SSN_PATTERN, "[REDACTED_SSN]");
    result = result.replace(PHONE_PATTERN, "[REDACTED_PHONE]");
    result = result.replace(CREDIT_CARD_CANDIDATE_PATTERN, (match) => {
      const digitsOnly = match.replace(/[ -]/g, "");
      return passesLuhnCheck(digitsOnly) ? "[REDACTED_CARD]" : match;
    });
    return result;
  } catch (err) {
    console.error("[redact] internal error, failing open (returning original text):", err);
    return text;
  }
}
