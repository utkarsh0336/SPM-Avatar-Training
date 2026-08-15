import {
  createRedisSingleUseTicketStore,
  generateOpaqueToken,
  type SingleUseTicketStore,
} from "@avatrain/shared";

/**
 * Ticket-based auth for the WS upgrade route. Next.js Route Handlers
 * (apps/dashboard/app/api/[...path]/route.ts) can't upgrade HTTP to
 * WebSocket, so a browser WebSocket connecting directly to apps/api is a
 * different origin than the dashboard's cookie — it carries no cookie at
 * all, and browsers can't set custom headers on a WS handshake. Fix: mint a
 * short-lived, single-use ticket via a normal authenticated REST call
 * (which the proxy CAN forward), then pass it as a query param on the WS
 * URL. Reuses the same opaque-token primitive as session cookies/invites
 * (packages/shared/src/auth/tokens.ts) rather than inventing new crypto.
 *
 * Redis-backed (packages/shared/src/scaling/ws-ticket-store.ts), single-use
 * via an atomic get-and-delete — see
 * .claude/specs/distributed-ws-ticket-store.md. Previously an in-process
 * Map, which broke once apps/api started running with
 * min_machines_running >= 2 per region (infra/fly/api-*.toml): a ticket
 * minted on one machine was invisible to redeemWsTicket() on another.
 */
export interface WsTicketClaims {
  orgId: string;
  /** null for an anonymous embed visitor (routes/embed.ts) — a publishable-key-minted ticket has no real user behind it. */
  userId: string | null;
  /**
   * Set only by routes/embed.ts's ticket mint — the Application's pinned
   * avatarId, authoritative for persona resolution server-side
   * (conversation-service.ts ignores any client-sent persona fields when
   * this is present, the same trust posture getCallerSimliFaceId already
   * applies to simliFaceId). Undefined for a normal authenticated session.
   */
  pinnedAvatarId?: string;
}

interface StoredTicketPayload extends WsTicketClaims {
  expiresAt: number;
}

const TICKET_TTL_MS = 60_000;

function ticketKey(ticket: string): string {
  return `ws-ticket:${ticket}`;
}

// Module-level singleton, same reasoning as rate-limiter.ts's sharedLimiter: a fresh ioredis
// connection per call would leak one per request with nothing ever closing it.
let sharedStore: SingleUseTicketStore | null = null;
function getStore(): SingleUseTicketStore {
  if (!sharedStore) sharedStore = createRedisSingleUseTicketStore();
  return sharedStore;
}

export interface WsTicketDeps {
  /** Injectable for tests. Defaults to the shared module-level store. */
  store?: SingleUseTicketStore;
  /** Injectable clock for tests. */
  now?: () => number;
}

export async function mintWsTicket(
  claims: WsTicketClaims,
  deps: WsTicketDeps = {},
): Promise<{ ticket: string; expiresAt: number }> {
  const store = deps.store ?? getStore();
  const now = deps.now ?? Date.now;
  const ticket = generateOpaqueToken();
  const expiresAt = now() + TICKET_TTL_MS;
  const payload: StoredTicketPayload = { ...claims, expiresAt };
  await store.put(ticketKey(ticket), JSON.stringify(payload), TICKET_TTL_MS);
  return { ticket, expiresAt };
}

/**
 * One-time use: takeOnce() removes the ticket from the store whether or not
 * it was valid, matching the old Map-based implementation's "consumed even
 * though expired" semantics. `expiresAt` is re-checked here in JS rather
 * than relying solely on the store's own TTL — Redis key eviction isn't
 * instantaneous at the millisecond the TTL elapses, so this is the
 * authoritative check, not a redundant one.
 *
 * Fails closed on a store error: the opposite of checkRateLimit's fail-open
 * posture, because this is an auth boundary, not a quota — an unreadable
 * ticket store must never be treated as "ticket valid." See
 * .claude/specs/distributed-ws-ticket-store.md's Implementation Rules.
 */
export async function redeemWsTicket(ticket: string, deps: WsTicketDeps = {}): Promise<WsTicketClaims | null> {
  const store = deps.store ?? getStore();
  const now = deps.now ?? Date.now;

  let raw: string | null;
  try {
    raw = await store.takeOnce(ticketKey(ticket));
  } catch (err) {
    console.error("[ws-tickets] Redis error during redemption, failing closed:", err);
    return null;
  }
  if (!raw) return null;

  const stored = JSON.parse(raw) as StoredTicketPayload;
  if (stored.expiresAt < now()) return null;
  return { orgId: stored.orgId, userId: stored.userId, pinnedAvatarId: stored.pinnedAvatarId };
}
