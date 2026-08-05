---
paths:
  - "packages/realtime-core/**"
  - "apps/agent/**"
  - "apps/widget/src/session/**"
---

# Realtime layer rules

- Event names come from `packages/realtime-core/src/events.ts`. Never type a literal event string
  inline. If an event is missing, add it to the enum with a docs link in the comment.
- No `session.update` before `pc.connectionState === 'connected'`.
- Data channel is `oai-events`. Nothing else.
- Do not send `OpenAI-Beta: realtime=v1` — that header belongs to the retired beta interface.
- Ephemeral secrets (`ek_…`) are never logged, persisted, or reused. 60s TTL, one session.
- `reasoning.effort` defaults to `"low"`. Raising it requires an explicit per-turn escalation path
  with a filler utterance.
- Barge-in handler order is fixed: stop playback → flush queue → `response.cancel` → mouth to
  neutral. All within one animation frame.
- No `await` on a tool call inside the speech path without emitting a filler first.
- Nothing new in the audio callback. Metrics go through `requestIdleCallback` or a worker.
- Any diff here requires `pnpm bench:latency` output in the PR. Run `latency-auditor` first.