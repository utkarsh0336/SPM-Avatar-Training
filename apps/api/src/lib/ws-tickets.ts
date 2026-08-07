import { generateOpaqueToken } from "@avatrain/shared";

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
 * In-memory only, like lib/rate-limit.ts — apps/api is single-process for
 * now; a distributed ticket store is an explicit non-goal until there's a
 * real deploy topology to design against.
 */
export interface WsTicketClaims {
  orgId: string;
  userId: string;
}

interface StoredTicket extends WsTicketClaims {
  expiresAt: number;
}

const TICKET_TTL_MS = 60_000;
const tickets = new Map<string, StoredTicket>();

function sweep(now: number): void {
  for (const [key, value] of tickets) {
    if (value.expiresAt < now) tickets.delete(key);
  }
}

export function mintWsTicket(claims: WsTicketClaims): { ticket: string; expiresAt: number } {
  const now = Date.now();
  sweep(now);
  const ticket = generateOpaqueToken();
  const expiresAt = now + TICKET_TTL_MS;
  tickets.set(ticket, { ...claims, expiresAt });
  return { ticket, expiresAt };
}

/** One-time use: redeeming a ticket removes it, whether or not it was valid. */
export function redeemWsTicket(ticket: string): WsTicketClaims | null {
  const stored = tickets.get(ticket);
  tickets.delete(ticket);
  if (!stored) return null;
  if (stored.expiresAt < Date.now()) return null;
  return { orgId: stored.orgId, userId: stored.userId };
}
