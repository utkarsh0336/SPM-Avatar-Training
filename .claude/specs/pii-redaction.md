# Spec: PII Redaction

## Overview

`packages/shared/src/redact.ts` is currently a literal no-op stub:

```ts
export function redact(text: string): string {
  return text;
}
```

explicitly labeled "Phase 0 stub" in its own doc comment, with real redaction deferred to "the
transcript pipeline in Phase 1." It's already wired into both write paths `.claude/rules/tenancy.md`
requires ("Redact PII before insert, never on read"):

- `apps/api/src/services/training-session-service.ts`'s `persistTrainingSessionMessage` —
  `Message.content`, called fire-and-forget (`void`, never awaited) directly from
  `conversation-service.ts`'s `processTurn`, on the WS realtime hot path.
- `apps/api/src/services/analytics-service.ts` — `SatisfactionRating.comment`.

This spec gives `redact()` a real implementation: synchronous, pattern-based detection and
scrubbing of high-confidence structured PII, called at exactly the same two sites, with the same
`(text: string) => string` contract. Every `Message.content` and rating `comment` row written since
3.9.5 shipped is unredacted PII at rest today (RLS-protected — cross-tenant reads are still zero
rows — but not scrubbed within a tenant's own visibility, e.g. from a trainer reviewing a session
transcript).

---

## Business Goal

Avatrain transcripts are training conversations, not anonymous chat — learners routinely say things
like "my email is..." or "call me at..." mid-session, especially in scenario/roleplay-style
training. Every one of those turns is persisted verbatim today. That's a real compliance exposure
for a multi-tenant SaaS handling customer training data, and it's already been called out as a known
gap in three places (`training-session-service.ts`, `analytics-service.ts`, and
`.claude/specs/video-chat-session.md`'s own "flagged to security-reviewer, not silently shipped as
if PII scrubbing were real"). This spec closes that gap for newly written rows.

---

## Depends On

None. Both write paths and the `Message.content` / `SatisfactionRating.comment` columns already
exist; this only changes what `redact()` does internally.

---

## Components Affected

- `packages/shared` (`redact.ts`, `redact.test.ts`)

No other package needs code changes — `apps/api`'s two call sites already invoke `redact()` with
the correct contract; only its internals change.

---

## API Changes

No API changes. `redact()` is not a public API surface — it's an internal write-time transform with
no route, schema, or client-visible contract of its own.

---

## Database Changes

No database changes. No new columns. Explicit non-goal: an earlier spec draft
(`.claude/specs/video-chat-session.md`) sketched a `Message.redacted Boolean` audit flag, but it was
never actually added to `prisma/schema.prisma` — this spec doesn't add it either. If "prove which
rows were scrubbed and under which pattern version" becomes a real compliance requirement, that's a
follow-up spec, not bundled in here.

---

## UI Changes

No UI changes. Redacted placeholder tokens (e.g. `[REDACTED_EMAIL]`) render as plain text through
the dashboard's existing transcript views — nothing in the render path needs to know redaction
happened.

---

## Realtime Changes

`redact()` is called synchronously and inline from `persistTrainingSessionMessage`, itself
fire-and-forget on `conversation-service.ts`'s per-turn hot path — per that function's own doc
comment, it "must never be awaited by its caller and must never throw out of that call site." That
constraint now applies to `redact()`'s implementation directly, not just its caller:

- **No I/O, no async work.** Regex-based pattern matching only — no network call to an external PII
  API, no local ML/NER model. Either would violate "avoid blocking the realtime audio path"
  (`.claude/rules/realtime.md`) and "do not perform expensive work inside realtime event handlers"
  (`CLAUDE.md`).
- **ReDoS-safe patterns only.** The input is STT-transcribed learner speech — attacker-influenced
  text, run through this function on every single persisted turn. Patterns must use bounded
  quantifiers with no nested/overlapping quantifiers that admit catastrophic backtracking. Test for
  this explicitly (see Testing).
- **Must never throw.** Wrap the matching logic defensively; on any internal fault, fail open —
  return the original text rather than throwing or blocking the turn. See the fail-open trade-off
  called out in Implementation Rules below; this mirrors `persistTrainingSessionMessage`'s own
  "catch and log, never propagate" posture one level down.

---

## Files to Modify

- `packages/shared/src/redact.ts` — real pattern-based implementation.
- `packages/shared/src/redact.test.ts` — currently one test asserting identity-function behavior
  ("is the identity function until Phase 1 redaction rules land"); replace with real coverage per
  Testing below.

---

## Files to Create

None required. Keep patterns in `redact.ts` itself unless the pattern list grows large enough to
warrant splitting out a `redact-patterns.ts` — not anticipated for the v1 scope below, and splitting
prematurely would be exactly the kind of unrequested abstraction `CLAUDE.md` says to avoid.

---

## Dependencies

No new dependencies. Pure regex, no NPM package. Explicit non-goal: no NER/ML-based entity-detection
library (see Realtime Changes — would violate the synchronous/no-I/O constraint, and `CLAUDE.md`
requires approval before adding any new dependency regardless).

---

## Explicit Non-Goals

- **Free-text entity detection** (person names, physical/mailing addresses, employer names). These
  require NER, not regex, and are a fundamentally different (heavier, probabilistic) approach. v1
  scope is high-confidence *structured* PII only: email addresses, phone numbers (common
  US/international formats), SSN-shaped 9-digit sequences, and credit-card-shaped sequences (14–19
  digits, validated with a Luhn check to cut false positives on generic long numbers). If free-text
  entity redaction is wanted later, that's a separate spec — the synchronous/no-I/O constraint above
  likely means it can't live inline in this same call path anyway.
- **Historical backfill.** Rows written before this spec ships stay unredacted. Re-scanning and
  redacting `Message`/`SatisfactionRating` history retroactively is a separate, one-off
  migration-style job, not bundled here.
- **Transcript retention/deletion.** `docs/ARCHITECTURE.md` §3 lists Transcript lifetime as
  `retentionDays`, but no retention/deletion job for `Message` rows actually exists in this codebase
  today (only `apps/api/src/lib/uptime-retention-job.ts`, which is unrelated — it governs
  `UptimeCheck` rows from the reliability spec). That's a real, separate gap found while researching
  this spec: redaction-at-write reduces what's exposed in a live transcript, but doesn't bound how
  long an org's raw (now-redacted-going-forward, but still real) transcript data is retained. Not
  fixed here — flagging it as a follow-up, likely its own spec mirroring
  `uptime-retention-job.ts`'s pattern.
- **A `redacted` audit column** — see Database Changes.

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY`
- Maintain tenant isolation using `org_id`
- Keep provider-specific logic inside adapters
- Validate APIs with Zod
- Preserve the public embed SDK contract
- Keep realtime latency low
- Use strict TypeScript
- Never use `any`
- Prefer modifying existing code
- Run `pnpm verify`
- Update documentation when public APIs change

Specific to this spec:

- **Bias toward over-redaction.** A false positive (redacting something that wasn't really PII)
  degrades transcript readability for a trainer reviewing a session. A false negative (missing real
  PII) is the compliance failure this spec exists to prevent. Where a pattern's precision is
  genuinely uncertain, prefer the stricter variant.
- **Fail-open on internal error, by design, not by accident.** If `redact()`'s matching logic hits
  an unexpected fault, it returns the original text rather than throwing (consistent with never
  blocking the pedagogical path) or replacing the whole message with a generic placeholder
  (destroying legitimate content on a scrubbing bug would be worse than the bug itself, and analytics
  built on transcript content would lose real substance). This is the same fail-open-vs-fail-closed
  judgment call `packages/shared/src/scaling/rate-limiter.ts` made explicitly for a different
  reason — document the choice in code the same way, so it's a reviewed decision, not silent. Note
  this is the opposite trade-off from `.claude/specs/distributed-ws-ticket-store.md`'s ticket store,
  which must fail *closed* — the two aren't the same shape of problem (auth bypass vs. a scrubbing
  gap that's already the pre-existing baseline).
- Replace matched PII with a typed placeholder token (e.g. `[REDACTED_EMAIL]`, `[REDACTED_PHONE]`)
  rather than deleting it outright — preserves sentence structure for anyone reading the transcript
  later.

---

## Testing

- **Unit Tests** (`redact.test.ts`): for each pattern (email, phone, SSN-shaped, credit-card-shaped
  with Luhn validation) — a positive case that gets redacted, and at least one adjacent negative
  case that must *not* be redacted (e.g. a plain 9-digit number that isn't SSN-shaped in context, a
  16-digit number that fails Luhn). Also: never throws on arbitrary/malformed input; ReDoS
  safety (assert matching a long adversarial input — e.g. a several-KB string of repeated
  near-matching characters — completes in bounded time, not just "doesn't crash"); idempotency
  (redacting already-redacted text is a no-op); non-PII surrounding text is preserved unchanged.
- **Integration Tests**: extend `training-session-service.test.ts` and `analytics-service.test.ts`
  with at least one case each asserting that content containing a detectable PII pattern is actually
  redacted in what gets persisted — today neither file asserts anything about `redact()`'s output
  (it was a no-op, nothing to assert).
- **End-to-End Tests**: not applicable — no user-facing flow changes.
- **Realtime Tests**: confirm `persistTrainingSessionMessage`'s existing fire-and-forget contract is
  unchanged (still `void`, still never throws out of the call site) with real redaction logic
  inline.
- **Latency Benchmarks**: `pnpm bench:latency` — this function now does real work (previously a
  single return statement) inline on the per-turn path; confirm no regression against the existing
  TTFA budget.
- **Manual Verification**: run a training session, say a sentence containing an email/phone number,
  confirm the persisted `Message.content` (via `GET /v1/training-sessions/:id/messages`) shows the
  redacted placeholder, not the raw value.

---

## Definition of Done

- Feature works end-to-end
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated (this spec + `redact.ts`'s own doc comment, which should stop describing
  itself as a "Phase 0 stub" once real patterns land)
- Latency budget maintained (`pnpm bench:latency`)
- No security regressions — explicitly: redaction only ever narrows what's persisted (never expands
  it), and a `redact()` internal fault degrades to today's existing behavior (unredacted, matching
  current baseline) rather than to a worse state (e.g. throwing and dropping the turn)
