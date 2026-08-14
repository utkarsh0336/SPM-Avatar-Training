# Spec: Voice Quality & Latency Enforcement

## Overview

This spec closes four gaps identified in the "3.6 Voice & Speech Capabilities" review of the
already-shipped voice pipeline (Groq Whisper STT, echogarden/Piper + msedge-tts two-tier TTS,
client-side VAD/barge-in, per-turn latency instrumentation — all real, in
`apps/api/src/services/conversation-service.ts` and `packages/shared/src/providers/*`):

1. **No noise-reduction step before STT.** `getUserMedia({ audio: true })` is called with no
   constraints at all in three places, so the browser's native noise suppression / echo
   cancellation / auto gain control are left at whatever default the user-agent happens to pick
   (not guaranteed on) rather than deliberately requested.
2. **No accent-adaptation.** `STTTranscribeOptions` (`packages/shared/src/providers/types.ts`)
   carries only a `language` hint; there is no vocabulary-biasing and no confidence signal
   surfaced from Whisper at all today.
3. **No voice/language support beyond English/Hindi.** `languageSchema` in
   `packages/shared/src/tutor/avatar-config.ts` is a two-value enum, wired end-to-end through
   `WHISPER_LANGUAGE_CODE` (STT) and the Hindi-only `msedge-tts` branch (TTS) — extensible in
   shape, but nothing else is actually wired.
4. **The latency target is measured, not enforced.** `TurnLatencyTracker`
   (`packages/shared/src/tutor/latency-log.ts`) records `sttMs`/`retrievalMs`/`llmFirstTokenMs`/
   `ttsFirstChunkMs`/`totalMs` and forwards them in the `latency` WS message, but nothing in
   `processTurn` ever compares those numbers against a budget or reacts when a turn runs long.
   The only enforced timeout in the whole turn today is `RETRIEVAL_TIMEOUT_MS = 250` via
   `withRetrievalTimeout` — a single-hop circuit breaker, not a whole-turn one.

This is hardening work on an existing, shipped pipeline — it does not add a new user-facing
feature surface, and it deliberately does not touch transport (still the plain WebSocket
described in `.claude/rules/realtime.md`), avatar rendering, or billing.

---

## Business Goal

Voice latency and audio robustness are the product's core felt quality — `CLAUDE.md`'s
Performance Rules call latency "a product feature," and `.claude/agents/latency-auditor.md`
already treats it as a p95 SLA (900ms direct / **1400ms mediated** — this codebase's transport).
Two concrete business risks follow from the four gaps above: (a) noisy environments (open-plan
offices, mobile, background chatter — realistic for corporate training) degrade transcription
accuracy silently, with no lever pulled to help; (b) a slow provider (Whisper, echogarden,
msedge-tts, or the LLM) currently degrades the learner experience turn after turn with nothing
in the system reacting to it, because "measured" and "acted upon" are two different things and
only the first exists. Closing these gaps protects the metric the product is actually sold on.

Note: the 3.6 review's "≤2s" figure is treated here as the informal description of a target that
was never actually encoded anywhere in code. The number this spec enforces is the one already
authoritative in this codebase — `latency-auditor`'s documented **1400ms p95 mediated-mode TTFA**
— rather than inventing a second, looser budget that would disagree with it.

---

## Depends On

None. All four gaps are hardening on pipeline pieces that are already built and in use
(`stt-groq-whisper.ts`, `tts-factory.ts`/`tts-failover.ts`, `latency-log.ts`,
`conversation-service.ts`). `docs/ROADMAP.md`'s Phase 1 describes a WebRTC/OpenAI-Realtime
direct-connect skeleton that was never built that way — the actually-shipped transport is the
plain WebSocket documented in `.claude/rules/realtime.md` — so Phase-ordering does not gate this
work.

---

## Components Affected

- `apps/widget` — mic capture constraints.
- `apps/dashboard` — mic capture constraints (trainer rehearsal + voice-ai preview share the same
  gap).
- `apps/api` — turn-latency enforcement in `conversation-service.ts`.
- `packages/shared` — STT/TTS provider changes, language schema, new WS message.

Explicitly **not affected**: `apps/agent`, `packages/avatar-core`, `prisma` (no new persisted
state — see Database Changes), `packages/embed`.

---

## API Changes

No REST API changes.

---

## Database Changes

No database changes. The circuit breaker introduced below is in-memory and per-process, matching
the existing precedent in `apps/api/src/lib/rate-limit.ts` (see that file's own comment: "Redis-
backed distributed limiting is an explicit spec non-goal — this per-process approximation is
acceptable as-is; apps/api is stateless but not (yet) horizontally scaled"). This spec follows
the same, already-accepted convention rather than introducing a new Redis-backed pattern for a
single concern.

---

## UI Changes

None required for correctness. Optionally, the widget/dashboard MAY render a subtle "still
working" affordance on the new `latency.budget_exceeded` message (see Realtime Changes) — left as
a follow-up, not a blocking part of this spec, since no filler-utterance mechanism exists yet to
pair it with (see the explicit non-goal below).

---

## Realtime Changes

### 1. Noise reduction (capture-time, zero added latency, zero new dependency)

Request native browser DSP at `getUserMedia` call time instead of leaving it to
user-agent defaults, in all three call sites:

- `apps/widget/src/useEmbedSession.ts:97`
- `apps/dashboard/app/voice-ai/[voiceSessionId]/useVoiceConversationSession.ts:99`
- `apps/dashboard/app/sessions/[trainingSessionId]/useConversationSession.ts:182`

```ts
navigator.mediaDevices.getUserMedia({
  audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
})
```

This is deliberately scoped to native `MediaTrackConstraints` — not a WASM denoiser (e.g.
RNNoise) inserted into the capture graph ahead of `MediaRecorder`/`voice-activity-detector.ts`.
A WASM-based denoiser would add a new dependency (requires approval per `CLAUDE.md`) and CPU work
to the exact audio path `.claude/rules/realtime.md` and `latency-auditor` guard most closely; it
is a reasonable follow-up but is out of scope here. `latency-auditor` review is still required for
this diff since it touches the mic capture chain feeding both `MediaRecorder` and the VAD.

### 2. Accent adaptation (vocabulary biasing + confidence telemetry, not a retry)

`STTTranscribeOptions` (`packages/shared/src/providers/types.ts`) gains one additive field:

```ts
export interface STTTranscribeOptions {
  language?: string;
  /** Domain-vocabulary bias, e.g. curriculum/avatar terminology. Passed through verbatim to providers that support it. */
  prompt?: string;
}
```

`stt-groq-whisper.ts` forwards `opts.prompt` as the `prompt` form field on the existing single
`/audio/transcriptions` call (**verify live against Groq's current API surface before
implementation**, per `CLAUDE.md`'s "Verify external APIs before implementation" — the same
verification discipline already used for this file's `DEFAULT_MODEL` and endpoint). `prompt` is
populated from the avatar's `expertise`/curriculum title where available, threaded from
`conversation-service.ts` alongside the existing `language` hint.

Deliberately **not building**: a low-confidence retry loop. Whisper's `verbose_json` response
format can expose a confidence signal (`avg_logprob`/`no_speech_prob` per segment) — this spec
switches the request to `verbose_json` and logs that signal as telemetry (same structured
`console.log` pattern as `latency-log.ts`), but does **not** use it to trigger a second STT call.
A synchronous retry-on-low-confidence is exactly what `latency-auditor` flags ("synchronous or
awaited calls in the speech path without a preceding filler utterance") — and
`conversation-service.ts` already documents that this pipeline has no filler-utterance mechanism.
Building one is a real feature with its own latency budget implications, not a one-line addition;
it's called out as a non-goal here rather than smuggled in underscoped.

### 3. A third language (Spanish), wired end-to-end

Extends `languageSchema` (`packages/shared/src/tutor/avatar-config.ts`) from
`z.enum(["English", "Hindi"])` to include `"Spanish"`, following the exact precedent already
established for Hindi:

- `WHISPER_LANGUAGE_CODE` (`stt-factory.ts`) gains `Spanish: "es"` — low-risk, since
  `whisper-large-v3-turbo` is already multilingual and this is only an accuracy hint, not a
  capability gate.
- `tts-voice-map.ts` gains a `SPANISH_VOICE_BY_GENDER` map and `resolveSpanishVoice()`, mirroring
  `HINDI_VOICE_BY_GENDER`/`resolveHindiVoice()` exactly, including its doc-comment convention of
  citing which live lookup verified the voice names.
- `tts-factory.ts`'s `language === "Hindi"` branch generalizes to a small
  `NON_ENGLISH_VOICE_RESOLVERS` map keyed by `Language`, so Spanish (and any future non-English
  language) follows the same "msedge-tts only, no echogarden/Piper candidate" shape without a new
  `if` branch per language.

**Required before implementation, not an assumption baked into code**: verify live, exactly as
`tts-voice-map.ts`'s existing Hindi comment did —
1. `echogarden`'s installed `vits` (Piper) catalog via `requestVoiceList({ engine: "vits" })` for
   any `es_*` entries (if present, Spanish could get a real primary+fallback pair instead of
   msedge-tts-only).
2. `msedge-tts`'s own `getVoices()` for confirmed `es-ES`/`es-MX` neural voice names and their
   declared `Gender` field.

If live verification finds no usable voice on either provider, this spec's Definition of Done for
item 3 is not met and Spanish support should not be declared shipped — do not guess voice names.

### 4. Whole-turn latency SLA gate + circuit breaker

New file `apps/api/src/services/turn-latency-guard.ts` (+ test), mirroring the existing
`RETRIEVAL_TIMEOUT_MS`/`withRetrievalTimeout` precedent in `conversation-service.ts`:

```ts
// latency-auditor's documented p95 mediated-mode TTFA budget — see .claude/agents/latency-auditor.md.
export const TURN_TTFA_BUDGET_MS = 1400;

// Per-process, not distributed — same accepted precedent as apps/api/src/lib/rate-limit.ts.
export interface TurnLatencyCircuitBreaker {
  recordTurn(orgId: string, ttsFirstChunkMs: number | undefined): void;
  isTripped(orgId: string): boolean;
}
export function createTurnLatencyCircuitBreaker(opts?: { consecutiveMissesToTrip?: number }): TurnLatencyCircuitBreaker;
```

Wiring in `processTurn` (`conversation-service.ts`):

- Right after `send({ type: "turn.started", utteranceId })`, start a `setTimeout(TURN_TTFA_BUDGET_MS)`
  watchdog. Clear it the moment `tracker.markTtsFirstChunk()` fires (already called inside
  `synthesizeSentence` for the first sentence) or the turn ends/aborts. If it fires, send one new,
  additive WS message (below) — this is a signal, not a turn failure; the turn keeps running.
- At `tracker.finish(...)` (where `sttMs`/`retrievalMs`/`llmFirstTokenMs`/`ttsFirstChunkMs`/
  `totalMs` are already logged today), call `circuitBreaker.recordTurn(claims.orgId, entry.ttsFirstChunkMs)`.
- Before starting the next turn's retrieval call, check `circuitBreaker.isTripped(claims.orgId)`.
  If tripped: skip `retrieveKnowledge` entirely (same ungrounded-degradation path
  `withRetrievalTimeout`'s own timeout already exercises — "degrade, never drop") and pass
  `env.TTS_PROVIDER = "msedge-tts"`-equivalent ordering into `createTTSProviderFromEnv` for that
  turn only, so a turn known to be running behind doesn't also pay for a slow primary-TTS attempt
  before failing over. The breaker resets the first time a turn comes in under budget.
- Default trip threshold: 3 consecutive over-budget turns for the same `orgId` — high enough that
  one slow turn (network blip) doesn't trip it, low enough that a genuinely degraded provider gets
  caught within the same short session.

New additive WS message (`packages/shared/src/realtime/ws-messages.ts`), added to
`serverMessageSchema`'s discriminated union:

```ts
export const latencyBudgetExceededMessageSchema = z.object({
  type: z.literal("latency.budget_exceeded"),
  utteranceId: z.string(),
  budgetMs: z.number(),
});
```

Nothing in this section adds work to the audio callback path — the watchdog timer and circuit
breaker live entirely in `apps/api`'s server-side turn orchestration (`processTurn`), not the
client's mic/VAD tick, which is the boundary `.claude/rules/realtime.md` actually draws ("nothing
new in the audio callback path"). `latency-auditor` review and `pnpm bench:latency` output are
still required for this diff per that rule.

---

## Files to Modify

- `apps/widget/src/useEmbedSession.ts`
- `apps/dashboard/app/voice-ai/[voiceSessionId]/useVoiceConversationSession.ts`
- `apps/dashboard/app/sessions/[trainingSessionId]/useConversationSession.ts`
- `apps/api/src/services/conversation-service.ts`
- `packages/shared/src/providers/types.ts`
- `packages/shared/src/providers/stt-groq-whisper.ts`
- `packages/shared/src/providers/stt-factory.ts`
- `packages/shared/src/providers/tts-voice-map.ts`
- `packages/shared/src/providers/tts-factory.ts`
- `packages/shared/src/tutor/avatar-config.ts`
- `packages/shared/src/realtime/ws-messages.ts`
- `packages/shared/src/index.ts` (export new constants/types)
- `docs/ARCHITECTURE.md` (§2 failure-mode table gains a `Turn TTFA over budget` row: detection =
  `turn-latency-guard.ts` watchdog, recovery = `latency.budget_exceeded` signal + circuit-breaker
  degradation, learner sees = nothing blocking, turn continues)

## Files to Create

- `apps/api/src/services/turn-latency-guard.ts` (+ test)

---

## Dependencies

No new dependencies. `noiseSuppression`/`echoCancellation`/`autoGainControl` are native
`MediaTrackConstraints`. The STT `prompt`/`verbose_json` fields are additional parameters on the
existing Groq REST call. The Spanish voices (if verification in Realtime Changes §3 succeeds) come
from the already-installed `echogarden` and `msedge-tts` packages. The circuit breaker is plain
in-memory TypeScript, matching `rate-limit.ts`'s precedent.

---

## Implementation Rules

- Follow every rule in `CLAUDE.md`.
- Never expose `OPENAI_API_KEY` — untouched by this spec.
- Maintain tenant isolation using `org_id` — the circuit breaker is keyed by `claims.orgId`
  (already-authenticated, server-derived; never a client-supplied value).
- Keep provider-specific logic inside adapters — Groq's `prompt`/`verbose_json` fields stay inside
  `stt-groq-whisper.ts`; the generalized non-English voice resolver stays inside
  `tts-voice-map.ts`/`tts-factory.ts`.
- Validate all new/changed shapes with Zod (`latencyBudgetExceededMessageSchema`, the extended
  `languageSchema`).
- Preserve the public embed SDK contract — `packages/embed` is untouched.
- Keep realtime latency low; do no expensive work inside the audio callback path (see Realtime
  Changes §4's explicit boundary note). Do not build the confidence-retry loop — see §2's explicit
  non-goal.
- Use strict TypeScript, no `any`.
- Prefer modifying existing code — no new provider files, no new failover mechanism; this spec
  extends `stt-factory.ts`/`tts-factory.ts`/`tts-voice-map.ts` in place.
- Run `pnpm verify` before considering any implementation PR complete.
- Run `latency-auditor` on the `apps/widget`, `apps/dashboard` capture-constraint diffs and the
  `apps/api/src/services/conversation-service.ts` / `turn-latency-guard.ts` diffs, per
  `.claude/rules/realtime.md`. Attach `pnpm bench:latency` output to the PR.
- Do not guess Spanish voice names — verify live per Realtime Changes §3 before writing
  `SPANISH_VOICE_BY_GENDER`.

---

## Testing

**Unit Tests**
- `turn-latency-guard.test.ts`: `isTripped` is false initially; false after 1-2 consecutive
  over-budget `recordTurn` calls for an org; true on the 3rd consecutive miss; resets to false the
  next time `recordTurn` is called with an under-budget value; breaker state for one `orgId` never
  affects another `orgId` (two-org isolation, even though this is in-memory not DB-backed).
- `stt-groq-whisper.test.ts`: `prompt` is forwarded as a form field when provided, omitted (not
  empty-stringed) when absent — mirroring the existing `language` field's own test pattern; a
  `verbose_json` response's confidence fields are parsed into the logged telemetry without
  affecting the returned transcript string's shape.
- `tts-voice-map.test.ts`: `resolveSpanishVoice` returns a voice for every `Gender`, mirroring the
  existing `resolveHindiVoice` test.
- `tts-factory.test.ts`: `language: "Spanish"` routes to the msedge-tts-only candidate list, same
  shape as the existing Hindi assertion.
- `ws-messages.test.ts`: `latencyBudgetExceededMessageSchema` round-trips and is a valid member of
  `serverMessageSchema`'s union.

**Integration Tests**
- `conversation-service.test.ts`: a turn whose mocked `synthesizeSentence` never resolves within
  `TURN_TTFA_BUDGET_MS` (fake timers) sends exactly one `latency.budget_exceeded` message and the
  turn still completes normally afterward; 3 consecutive slow turns for the same `orgId` cause the
  4th turn to skip `retrieveKnowledge` entirely (assert it's never called) and request the
  fallback-first TTS ordering.

**End-to-End Tests**
- Not applicable — no new UI surface is required by this spec.

**Realtime Tests**
- Fake-timer-driven, no live provider calls, consistent with this codebase's existing
  `conversation-service.test.ts` conventions.

**Latency Benchmarks**
- `pnpm bench:latency` output required in the PR, per `.claude/rules/realtime.md`, given diffs in
  `apps/api/src/services/conversation-service.ts` and the widget/dashboard capture chain.

**Manual Verification**
- Confirm noise suppression is actually requested (check the resolved `MediaTrackSettings` in
  devtools) in a real browser session for each of the three capture sites.
- Force a turn to run long (e.g. inject an artificial delay in a local `TTSProvider`) and confirm
  the `latency.budget_exceeded` message arrives and, after 3 in a row, subsequent turns visibly
  skip retrieval (check server logs) until a fast turn resets the breaker.
- Manually confirm Spanish end-to-end: speak a Spanish utterance, confirm transcription, LLM
  reply, and synthesized Spanish audio all resolve correctly, only after §3's live voice
  verification has passed.

---

## Definition of Done

- [ ] All three `getUserMedia` call sites request `noiseSuppression`/`echoCancellation`/
      `autoGainControl`
- [ ] `STTTranscribeOptions.prompt` implemented and forwarded to Groq; Whisper confidence signal
      logged as telemetry (no retry loop built)
- [ ] Spanish voice names verified live against both providers' real catalogs before being coded;
      Spanish wired through `languageSchema`, STT language hint, and TTS voice resolution
- [ ] `TURN_TTFA_BUDGET_MS` (1400ms, matching `latency-auditor`'s documented mediated-mode budget)
      enforced via a per-turn watchdog and a per-org, in-process circuit breaker
- [ ] `latency.budget_exceeded` WS message implemented, Zod-validated, added to
      `serverMessageSchema`
- [ ] `docs/ARCHITECTURE.md` §2's failure-mode table updated with the new row
- [ ] `latency-auditor` run on every diff touching the capture chain or `conversation-service.ts`;
      findings resolved; `pnpm bench:latency` output attached to the PR
- [ ] All tests pass
- [ ] `pnpm verify` passes
- [ ] No lint errors
- [ ] No TypeScript errors
- [ ] No security regressions (no new persisted data, no new client-trusted input introduced)
