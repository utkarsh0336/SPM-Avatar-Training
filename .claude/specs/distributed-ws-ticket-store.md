# Spec: Distributed WS Ticket Store

## Overview

`apps/api/src/lib/ws-tickets.ts` mints and redeems the short-lived, single-use tickets that
authenticate the WebSocket upgrade at `/v1/conversations/:trainingSessionId/ws` (see
`.claude/rules/realtime.md`: browsers can't attach a cookie or custom header to a cross-origin WS
handshake, so a normal authenticated `POST /v1/conversations/ticket` — or the unauthenticated,
publishable-key-gated `POST /v1/embed/ticket` — mints a 60s, single-use ticket that gets passed as
`?ticket=` on the WS URL). Today that ticket is stored in a plain `Map<string, StoredTicket>`, held
in the `apps/api` process's own memory.

`infra/fly/api-us.toml` and `infra/fly/api-eu.toml` both set `min_machines_running = 2`, from the
already-shipped auto-scaling work (`.claude/specs/auto-scaling.md`, PR #38). A mint request and the
WS upgrade request that follows it are two separate HTTP requests, load-balanced independently — if
they land on different machines, `redeemWsTicket()` on machine B finds nothing for a ticket minted
on machine A's `Map`, and the connection is rejected with `invalid_ticket` even though the ticket
was genuinely valid and unused. This is a hard connection failure, not a degraded one: no retry
logic on the client makes this transparent today, and it lands squarely on the path a learner uses
to start every training session.

This spec replaces the in-process `Map` with a Redis-backed store, following the same migration
`checkRateLimit` just went through for the identical reason (`packages/shared/src/scaling/rate-limiter.ts`,
commit `87486b7`) — except a rate limiter degrading by "roughly 2x weaker than configured" is a
tolerable trade-off, while a ticket store returning a false negative is not. The two stores'
failure-mode requirements are opposite of each other; see Implementation Rules.

---

## Business Goal

Every mediated (Mode A) and Mode B session starts by minting and redeeming one of these tickets.
An intermittent, load-balancer-routing-dependent connection failure on that path is an intermittent
failure to start *any* training session — the core product action. This directly serves
`docs/ARCHITECTURE.md` §2's "Degrade, never drop" principle, which this specific path currently
violates: there is no degrade here, only a drop.

---

## Depends On

None. `infra/fly/api-us.toml` / `api-eu.toml` (already shipped, PR #38) are what expose the bug;
they don't block this spec's implementation.

---

## Components Affected

- `apps/api` (`lib/ws-tickets.ts`; no expected changes to `routes/conversations.ts` or
  `routes/embed.ts` beyond what falls out of `ws-tickets.ts`'s exports staying the same shape)
- `packages/shared` (new Redis-backed store, alongside the existing `scaling/` primitives)
- `docs/ARCHITECTURE.md` (§3's state-ownership table currently doesn't reflect that ticket state
  has a server-side Redis home during its 60s window, not just the client-side widget-memory home
  it already documents)

---

## API Changes

No API changes. `POST /v1/conversations/ticket`, `POST /v1/embed/ticket`, and the
`GET /v1/conversations/:trainingSessionId/ws` upgrade route keep their existing request/response
shapes. `WsTicketClaims` (the public contract `mintWsTicket`/`redeemWsTicket` expose to their
callers) is unchanged.

---

## Database Changes

No database changes. This is Redis-only, same as `checkRateLimit` — per
`docs/ARCHITECTURE.md` §5's "Redis: quotas and counters only," a single-use, 60s-TTL auth nonce is
closer in kind to a rate-limit counter than to session truth, but it's a new category of Redis use
this codebase hasn't had before (ephemeral auth material, not a counter). Worth calling out
explicitly in the §5 update below rather than silently stretching "quotas and counters" to cover it.

---

## UI Changes

No UI changes.

---

## Realtime Changes

Ticket redemption runs in the WS route's `preValidation` hook (`routes/conversations.ts`), before
the upgrade completes — per `.claude/rules/realtime.md`, this hook must keep running inside
`app.after(...)` exactly as today; only what `redeemWsTicket()` does internally changes. This is
connection-setup latency, not per-turn/per-audio-chunk latency (it runs once per connection, not in
the audio callback path), but it is still on the realtime layer's boundary — `latency-auditor`
should review the diff and `pnpm bench:latency` should be run, per `.claude/rules/realtime.md`'s
blanket requirement for this directory, even though the budget it measures (TTFA, barge-in) isn't
directly touched by this change.

---

## Files to Modify

- `apps/api/src/lib/ws-tickets.ts` — `mintWsTicket`/`redeemWsTicket` become Redis-backed; exported
  signatures and `WsTicketClaims` shape unchanged so `routes/conversations.ts` and `routes/embed.ts`
  need no changes.
- `packages/shared/src/scaling/index.ts` — export the new store.
- `scripts/verify-provider-boundary.mjs` — add the new file (and its test file, if it imports
  `ioredis` directly rather than through an injected client) to the `ioredis` allowlist, same as
  `rate-limiter.ts` was added in commit `87486b7`.
- `docs/ARCHITECTURE.md` — §3's state table and §5's Redis note, per Database Changes above.

---

## Files to Create

- `packages/shared/src/scaling/ws-ticket-store.ts` — Redis-backed single-use ticket store.
- `packages/shared/src/scaling/ws-ticket-store.test.ts`

---

## Dependencies

No new dependencies. `ioredis` is already a `packages/shared` dependency (used by
`concurrency-counter.ts`, `redis-ping.ts`, `rate-limiter.ts`).

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

- **Fail closed, not open — the opposite of `checkRateLimit`.** `rate-limiter.ts` fails open on a
  Redis error because a rate limiter going dark is an availability trade-off (worst case: weaker
  abuse protection). A ticket store failing open would mean *any* malformed or garbage ticket is
  accepted as valid whenever Redis has a hiccup — an authentication bypass, not a degrade. On a
  Redis error, `redeemWsTicket()` must reject (return `null`, same as "ticket not found" today),
  never fall back to trusting an unredeemed claim.
- **Atomic get-and-delete.** Single-use is the whole security property here (see
  `.claude/specs/authentication.md`'s original design). Two concurrent redemption attempts for the
  same ticket must not both succeed — use a Lua `EVAL` (`GET` then `DEL` inside one script), the
  same technique `rate-limiter.ts` uses for its check-and-increment, not a separate `GET` + `DEL`
  round-trip.
- **Keep the 60s TTL** (`TICKET_TTL_MS`) — set via Redis `PEXPIRE`/`SET ... PX`, not the manual
  `sweep()` the in-process `Map` used (that sweep-on-mint approach was already a workaround for not
  having real per-key expiry; Redis makes it unnecessary).
- Never invent a second auth path for the WS upgrade — this only changes where the ticket is
  stored, not how it's minted, transmitted, or checked (`.claude/rules/realtime.md`).

---

## Testing

- **Unit Tests** (`ws-ticket-store.test.ts`, mirroring `rate-limiter.test.ts`'s injectable-client
  pattern): mint-then-redeem succeeds once; a second redemption of the same ticket fails; redeeming
  an unknown/garbage ticket fails; redeeming after the TTL elapses fails (injectable clock, same as
  `rate-limiter.test.ts`'s `now` option); a broken/erroring client causes redemption to fail
  *closed* (the inverse of `rate-limiter.test.ts`'s fail-open assertion — this is the test most
  worth getting right, since it's the one that would silently invert if this spec's implementation
  copy-pasted `rate-limiter.ts` without adjusting the failure mode).
- **Integration Tests**: extend `apps/api/src/lib/ws-tickets.test.ts` (currently unit-level per its
  own file, per `conversations.test.ts`'s comment that WS upgrade behavior is covered there) to
  exercise the real Redis-backed store instead of/alongside the in-process version, with the
  "different machine" scenario simulated as two independent client instances pointed at the same
  Redis key.
- **Realtime Tests**: none of the audio-path realtime tests are affected; confirm
  `conversations.test.ts`'s existing WS-adjacent tests still pass unchanged.
- **Latency Benchmarks**: `pnpm bench:latency`, per Realtime Changes above.
- **Manual Verification**: the actual bug this spec fixes — two machines racing a mint-then-connect
  pair — isn't reproducible against a single local `apps/api` process. Manual verification means a
  staging deploy with `min_machines_running >= 2` and repeated mint→connect round trips (e.g. a
  short script hitting the ticket route then the WS route in a loop) confirming zero `invalid_ticket`
  rejections for genuinely fresh tickets.

---

## Definition of Done

- Feature works end-to-end
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated (`docs/ARCHITECTURE.md` §3/§5)
- Latency budget maintained (`pnpm bench:latency`, `latency-auditor` reviewed)
- No security regressions — explicitly: ticket redemption fails closed on a Redis error, and
  single-use is still enforced atomically under concurrent redemption
