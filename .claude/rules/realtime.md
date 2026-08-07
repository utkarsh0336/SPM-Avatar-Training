---
paths:
  - "packages/realtime-core/**"
  - "apps/api/src/routes/conversations.ts"
  - "apps/api/src/services/conversation-service.ts"
  - "apps/agent/**"
  - "apps/widget/src/session/**"
---

# Realtime layer rules

Transport is a plain WebSocket (`apps/api`'s `/v1/conversations/:trainingSessionId/ws`), not
WebRTC/OpenAI Realtime — see `.claude/specs/ai-avatar.md`. The rules below reflect that.

- Wire message shapes come from `packages/shared/src/realtime/ws-messages.ts`'s Zod discriminated
  unions (`clientMessageSchema` / `serverMessageSchema`). Never construct or parse a message by
  hand-typing its `type` string inline — import the schema/type. If a message shape is missing, add
  it there first.
- Browsers can't attach a cookie or custom header to a cross-origin WS handshake. Auth is a
  short-lived, single-use ticket (`apps/api/src/lib/ws-tickets.ts`, 60s TTL): mint it via the normal
  authenticated `POST /v1/conversations/ticket` (goes through the cookie-carrying proxy), then pass
  it as `?ticket=` on the WS URL. Never invent a second auth path for this route.
- `@fastify/websocket` registration is async (avvio boot queue). Any route using `websocket: true`
  must be registered inside `app.after(...)` (or otherwise guaranteed to run after the plugin
  finishes booting) — declaring it synchronously right after `app.register(websocket)` silently skips
  the plugin's `onRoute` wrapping, and the handler gets called as a plain `(request, reply)` handler
  instead of `(socket, request)`, crashing on the first real connection with `socket.on is not a
  function`. This is a real, previously-shipped bug in this codebase — don't reintroduce it.
- Barge-in handler order is fixed (`barge-in-controller.ts`): stop local avatar playback
  synchronously first, then notify the server (fire-and-forget `barge_in` message). Server-side abort
  of in-flight TTS/LLM work is best-effort cleanup, not what the ~300ms budget is measured against —
  the budget is a client-side-only guarantee. Document this, don't quietly assume server abort is
  real-time.
- One `AbortController` per in-flight turn on the server, threaded through both the LLM `chat()` call
  and every `synthesize()` call via `opts.signal`. A `barge_in` message aborts it and sends
  `turn.cancelled`; a monotonic `currentUtteranceId` guard on the client drops any late audio from a
  now-stale turn.
- Sentence-boundary chunking (`packages/shared/src/tutor/sentence-chunker.ts`) is what "start TTS at
  the first sentence boundary" means in this codebase — don't build a second chunking scheme.
  Sentence audio is sent back to the client strictly in sentence order even though synthesis for
  later sentences may resolve first server-side.
- Nothing new in the audio callback path (recording, VAD tick, playback chain). Metrics/logging go
  through `requestIdleCallback`, a worker, or after-the-fact structured `console.log`, never inline
  in a hot per-chunk callback.
- Any diff here requires `pnpm bench:latency` output in the PR. Run `latency-auditor` first.
