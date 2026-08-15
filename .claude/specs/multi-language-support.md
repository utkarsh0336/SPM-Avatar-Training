# Spec: Multi-Language Support

## Overview

`languageSchema` (`packages/shared/src/tutor/avatar-config.ts`) is already `z.enum(["English", "Hindi",
"Spanish"])` and is genuinely wired end-to-end at the provider layer: `WHISPER_LANGUAGE_CODE`
(`stt-factory.ts`), `tts-voice-map.ts`'s live-verified `resolveSpanishPrimaryVoice`/
`resolveSpanishFallbackVoice` (real two-candidate echogarden+msedge-tts failover, unlike Hindi's
single-candidate msedge-tts-only path), and `system-prompt.ts`'s `LANGUAGE_INSTRUCTION` all already
handle Spanish correctly — this was shipped by `.claude/specs/voice-quality-latency-enforcement.md`
(merged, PR #30, "3.7-done"). So the premise "no third language is implemented" is not quite right:
Spanish *is* implemented at the pipeline layer.

What is actually missing is **reachability**. The trainer-facing, persisted setting for "what
language does this avatar speak" — `Avatar.preferredLanguage` / the `AvatarLanguage` Prisma enum —
is deliberately scoped as decorative metadata today, documented that way in three places
(`avatar-config.ts`'s doc comment on `avatarLanguageSchema`: "an Avatar's own metadata field... SOW
§3.1"; `PersonaDetailsStep.tsx`: "Metadata only... never fed into resolveReplicaId"; `readingLevelSchema`'s
own doc comment contrasting itself as "Unlike ageGroup/region/preferredLanguage above (metadata
only), this one is actually consumed"). It only offers `ENGLISH`/`HINDI` — Spanish isn't even a
choosable value — and nothing reads it to influence a real session.

Both real conversation surfaces confirm this: the public embed widget
(`apps/widget/src/useEmbedSession.ts:136`) and the dashboard's actual training-session flow
(`apps/dashboard/app/sessions/[trainingSessionId]/useConversationSession.ts:242`) both hardcode
`language: "English"` in the WS `session.start` payload, unconditionally, regardless of the avatar's
configured language. The session's own `ControlBar.tsx` even renders a "Language" popover offering
five options (`English, Spanish, French, German, Hindi`) — but it is pure decorative UI state
(`TrainingSessionContext`'s bare `language: string` field), never connected to the WS session at all,
and two of its five options (French, German) have never existed anywhere in `languageSchema`,
`WHISPER_LANGUAGE_CODE`, or `tts-voice-map.ts`. The only surface where a language picker is genuinely
live end-to-end today is the internal "Voice AI" trainer-preview tool
(`apps/dashboard/app/voice-ai/[voiceSessionId]`), which no real learner ever sees.

This spec closes the reachability gap: it makes `Avatar.preferredLanguage` a real, server-enforced
setting that actually drives the LLM/STT/TTS pipeline for both the embed widget and the dashboard
training-session flow, and extends `AvatarLanguage` to include `SPANISH` so the pipeline's existing
third language is actually selectable by a trainer. It does not touch the provider layer (already
correct), the already-live Voice AI preview tool, or the already-shipped dashboard chrome
localization (`.claude/specs/dashboard-localization.md`, English/Hindi UI strings — a different,
unrelated concern).

---

## Business Goal

SOW §3.1's sold positioning is "regional/language-specific avatars" (cited verbatim in both
`avatar-config.ts`'s and `prisma/schema.prisma`'s own doc comments on `AvatarLanguage`). Today that
promise doesn't hold for any real customer: a trainer can select "Hindi" for their avatar in the
onboarding wizard or `AvatarEditor.tsx`, publish it, embed it on their site, and every real learner
still hears English, because the setting was never wired past the picker UI. This is a materially
bigger gap than "we're missing a third language" — the *already-shipped* Hindi support doesn't reach
production learners either. Closing it is what makes the third language (Spanish) — and the existing
second one (Hindi) — actually available to the customers the product is positioned to sell to, not
just to an internal trainer using the preview tool.

---

## Depends On

- `.claude/specs/voice-quality-latency-enforcement.md` (merged, PR #30) — the `languageSchema`
  three-value enum, Whisper hint, and TTS voice resolution this spec builds on top of, unchanged
  here.

Not blocked by `.claude/specs/dashboard-localization.md` (merged, PR #32) — that spec's `UiLocale`
(portal chrome) is a different concern from `AvatarLanguage` (avatar conversation language); no file
overlap.

---

## Components Affected

- `apps/api`
- `apps/widget`
- `apps/dashboard`
- `packages/shared`
- `prisma`

---

## Scope decisions

1. **Language is trainer-set, audience-wide policy, resolved server-side from the Avatar record —
   never trusted from the client per session.** Exactly the same trust posture `readingLevel`
   already has in `conversation-service.ts`'s `session.start` handler
   (`.claude/specs/adaptive-learning-personalization.md`). `message.language` (client-supplied,
   defaults to `"English"`) stops being authoritative the moment an avatar record actually resolves
   (embed-pinned or dashboard `effectiveAvatarId`); it remains only as the safe fallback for the
   literal no-avatar-configured path (`DEFAULT_PERSONA`).

2. **Remove, don't wire, `ControlBar.tsx`'s per-session Language popover** in the dashboard
   training-session flow. It is non-functional decorative UI state today, disconnected from the real
   session, and two of its five listed options (French, German) don't exist anywhere in the backend.
   Once language becomes trainer-set/avatar-level (decision 1), a per-session learner-facing toggle
   is the wrong UX for it regardless — the same reason `readingLevel`, also trainer-set/audience-wide,
   has no control-bar toggle anywhere in this codebase.

3. **Voice AI's `VoiceControlBar.tsx` picker is left untouched.** It's an internal trainer
   preview/testing surface, not learner-facing, so a free-form per-session override is legitimate
   there — a trainer previewing how one avatar sounds in each supported language without editing the
   persisted config. It's also already fully correct (`LANGUAGE_OPTIONS: Language[] = ["English",
   "Hindi", "Spanish"]`, genuinely wired through `useVoiceConversationSession.ts`) — the reference
   implementation for what "wired" looks like, not something this spec changes.

4. **`apps/widget/src/useEmbedSession.ts` needs no functional change.** It already sends
   `config.avatarId`, and `routes/embed.ts`'s ticket mint already resolves that into
   `claims.pinnedAvatarId`, which `conversation-service.ts`'s `session.start` handler already uses to
   override `avatarName`/`expertise`/`voiceTone`/`gender`/`readingLevel` from the real Avatar record.
   This spec adds `language` to that same server-side override list — the widget's hardcoded
   `language: "English"` literal becomes an inert client default the server always overrides once a
   real avatar loads, exactly like its hardcoded `avatarName` etc. already are.

5. **Third spoken language is Spanish, not a new fourth one.** Extends `AvatarLanguage` (persisted
   enum) to match the pipeline's existing `Language`/`languageSchema`, which already has Spanish
   live-verified end-to-end per `voice-quality-latency-enforcement.md`. No new voice/STT provider
   verification is needed — the provider layer is untouched by this spec.

---

## API Changes

No new endpoints. `PATCH /v1/avatars/:avatarId` (existing, `avatar-service.ts`'s generic patch
passthrough) and the onboarding patch endpoint (`onboarding-service.ts`, same passthrough shape)
start accepting/returning `preferredLanguage: "SPANISH"` for free once `avatarLanguageSchema` gains
that value — no route or service code change, per `AvatarLanguage`'s own doc comment: "SCREAMING_CASE
values match every other avatar enum here, keeping avatar-service.ts's/onboarding-service.ts's
generic patch passthrough free of a value-casing mapping."

---

## Database Changes

- `AvatarLanguage` Postgres enum gains a third value:
  ```sql
  ALTER TYPE "AvatarLanguage" ADD VALUE 'SPANISH';
  ```
  Additive, no backfill needed — `preferred_language` is a nullable column, no existing row is
  affected.
- New migration `prisma/migrations/<timestamp>_add_avatar_language_spanish/migration.sql`, following
  the naming convention already used by
  `prisma/migrations/20260813190000_add_avatar_age_region_language`.
- No RLS changes. This adds a value to an existing enum column on the already-RLS-covered `avatars`
  table; no new table, no new column, no new policy needed.

---

## UI Changes

### Dashboard

- `apps/dashboard/app/onboarding/steps/PersonaDetailsStep.tsx` — `AVATAR_LANGUAGE_OPTIONS` gains
  `"SPANISH"`.
- `apps/dashboard/app/(dashboard)/avatars/[avatarId]/AvatarEditor.tsx` — `AVATAR_LANGUAGE_OPTIONS`
  gains `"SPANISH"`.
- `apps/dashboard/app/onboarding/types.ts` — `AVATAR_LANGUAGE_LABELS` gains `SPANISH: "Spanish"`.
- `apps/dashboard/app/sessions/[trainingSessionId]/ControlBar.tsx` — remove the Language popover
  control entirely (Scope decision 2). Mute/Camera/Fullscreen/Hide-Panel controls are unaffected.
- `apps/dashboard/app/sessions/[trainingSessionId]/TrainingSessionContext.tsx` — remove the
  `language: string` field from `TrainingSessionUiState` and `INITIAL_STATE`.
- Voice AI (`VoiceControlBar.tsx`, `VoiceSessionUiContext.tsx`, `VoiceConversationSessionContext.tsx`,
  `useVoiceConversationSession.ts`): no changes (Scope decision 3).

### Widget

No changes required (Scope decision 4).

### Avatar / Analytics / Admin

No changes.

---

## Realtime Changes

`apps/api/src/services/conversation-service.ts`'s `session.start` handler
(`handleClientMessage`'s `case "session.start"` block) gains a `language` resolution step mirroring
the existing `readingLevel` pattern exactly, in both branches that already load an Avatar record:

- **Embed / pinned branch** (`if (claims.pinnedAvatarId)`): after resolving `pinned`, also set
  `language = pinned?.preferredLanguage ? resolveSessionLanguage(pinned.preferredLanguage) : language`
  — same "override when present, otherwise leave the client-sent value" shape `avatarName`/
  `expertise`/`voiceTone`/`gender` already use in this branch.
- **Dashboard rehearsal branch** (`else if (effectiveAvatarId)`): after loading `avatar`, also set
  `language = avatar?.preferredLanguage ? resolveSessionLanguage(avatar.preferredLanguage) : language`
  — same shape `readingLevel` already uses in this branch.
- `message.language` (client-supplied, `languageSchema.default("English")`) remains the value used
  only when no avatar resolves at all — unchanged fallback behavior for `DEFAULT_PERSONA`'s
  no-avatar-configured path.

New pure function in `packages/shared/src/tutor/avatar-config.ts`, co-located with the two enums it
bridges:

```ts
const AVATAR_LANGUAGE_TO_LANGUAGE: Record<AvatarLanguage, Language> = {
  ENGLISH: "English",
  HINDI: "Hindi",
  SPANISH: "Spanish",
};

/** Maps the persisted, trainer-set Avatar.preferredLanguage to the Language value the conversation pipeline (LLM/STT/TTS) actually consumes. */
export function resolveSessionLanguage(avatarLanguage: AvatarLanguage): Language {
  return AVATAR_LANGUAGE_TO_LANGUAGE[avatarLanguage];
}
```

No change to `sessionStartMessageSchema`, `languageSchema`, `WHISPER_LANGUAGE_CODE`, or any TTS voice
map — all three languages are already correctly wired at that layer. No change to the audio callback
path, barge-in, or per-turn latency budget: `language` resolution happens once per `session.start`,
at the same point in the same handler `readingLevel` already resolves at, not per-turn — consistent
with `.claude/rules/realtime.md`'s "nothing new in the audio callback path."

---

## Files to Modify

- `prisma/schema.prisma` — `AvatarLanguage` enum gains `SPANISH`
- `packages/shared/src/tutor/avatar-config.ts` — `avatarLanguageSchema` gains `"SPANISH"`; new
  `resolveSessionLanguage()` / `AVATAR_LANGUAGE_TO_LANGUAGE`
- `apps/api/src/services/conversation-service.ts` — `session.start` handler resolves `language`
  server-side from the loaded Avatar record in both the embed-pinned and `effectiveAvatarId` branches
- `apps/dashboard/app/onboarding/steps/PersonaDetailsStep.tsx` — `AVATAR_LANGUAGE_OPTIONS`
- `apps/dashboard/app/onboarding/types.ts` — `AVATAR_LANGUAGE_LABELS`
- `apps/dashboard/app/(dashboard)/avatars/[avatarId]/AvatarEditor.tsx` — `AVATAR_LANGUAGE_OPTIONS`
- `apps/dashboard/app/sessions/[trainingSessionId]/ControlBar.tsx` — remove Language popover
- `apps/dashboard/app/sessions/[trainingSessionId]/TrainingSessionContext.tsx` — remove `language`
  UI-state field
- `apps/dashboard/app/sessions/[trainingSessionId]/useConversationSession.ts` — the hardcoded
  `language: "English"` literal stays (correct inert default per Scope decision 1); only its now-stale
  comment ("English is the only language actually implemented end-to-end so far") is corrected

---

## Files to Create

- `prisma/migrations/<timestamp>_add_avatar_language_spanish/migration.sql`

---

## Dependencies

No new dependencies.

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY`
- Maintain tenant isolation using `org_id` — `loadAvatarById(claims.orgId, ...)` is already org-scoped
  and unchanged by this spec; no new query is introduced
- Keep provider-specific logic inside adapters — no STT/TTS provider file is touched
- Validate APIs with Zod
- Preserve the public embed SDK contract — `packages/embed` is untouched; `useEmbedSession.ts` needs
  no change (Scope decision 4)
- Keep realtime latency low — `language` resolution is one-time at `session.start`, not per-turn
- Use strict TypeScript
- Never use `any`
- Prefer modifying existing code — no new provider files, no new mapping mechanism beyond the one
  small function bridging the two existing enums
- Run `pnpm verify`
- Update documentation when public APIs change

---

## Testing

**Unit Tests**
- `avatar-config.test.ts`: `resolveSessionLanguage` maps all three `AvatarLanguage` values to the
  correct `Language` value (an exhaustive `Record`, so a future fourth `AvatarLanguage` value is a
  compile error here until mapped).

**Integration Tests**
- `conversation-service.test.ts`: a `session.start` with an `avatarId` resolving to an Avatar with
  `preferredLanguage: "HINDI"` (regression) or `"SPANISH"` (new) drives the LLM system prompt / STT
  language hint / TTS voice resolution using the *resolved* language, regardless of what
  `message.language` the client sent — assert the server override wins. Same assertion for an embed
  session via `claims.pinnedAvatarId`. A session with no avatar at all falls back to
  `message.language`/`"English"` unchanged (regression check against current behavior).
- Avatar/onboarding route tests: `PATCH .../avatarId` and the onboarding patch endpoint accept
  `preferredLanguage: "SPANISH"` and round-trip it on a subsequent `GET`.

**End-to-End Tests**
- Dashboard: configure an avatar with Hindi (regression) and with Spanish (new) via
  `AvatarEditor.tsx`, start a real training session, confirm the avatar actually replies in that
  language — not just that the picker accepted the value. This is the concrete "reachability" check
  this spec exists for.
- Widget: embed a Spanish-configured avatar and confirm a full conversation happens in Spanish
  through the public embed widget end-to-end — the learner-facing surface the Business Goal is about.
- Confirm `ControlBar.tsx` no longer renders a Language control and nothing else in the training
  session UI regresses.

**Realtime Tests**
- None new — `session.start` handling stays synchronous/one-time per connection; no audio-path
  change.

**Latency Benchmarks**
- Not required — no change inside `processTurn`'s per-turn path, only the one-time `session.start`
  handler (the same class of change `readingLevel` resolution already is, which required none).

**Manual Verification**
- Confirm the dashboard training-session `ControlBar` no longer shows Language, with no console
  errors from the removed `TrainingSessionUiState.language` field.
- Confirm Voice AI's `VoiceControlBar.tsx` picker is unchanged and still works exactly as before.
- Speak a real Spanish utterance through both the dashboard session (Spanish-configured avatar) and
  the embed widget; confirm transcription, LLM reply, and synthesized Spanish audio all resolve
  correctly end-to-end.

---

## Definition of Done

- Feature works end-to-end
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained
- No security regressions
