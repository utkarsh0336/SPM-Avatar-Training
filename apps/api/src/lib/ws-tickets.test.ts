import { describe, expect, it, vi } from "vitest";
import { mintWsTicket, redeemWsTicket } from "./ws-tickets.js";

describe("ws-tickets", () => {
  it("mints a ticket that redeems to the original claims", () => {
    const { ticket } = mintWsTicket({ orgId: "org-1", userId: "user-1" });
    expect(redeemWsTicket(ticket)).toEqual({ orgId: "org-1", userId: "user-1" });
  });

  it("is single-use — a second redemption of the same ticket fails", () => {
    const { ticket } = mintWsTicket({ orgId: "org-1", userId: "user-1" });
    redeemWsTicket(ticket);
    expect(redeemWsTicket(ticket)).toBeNull();
  });

  it("rejects an unknown ticket", () => {
    expect(redeemWsTicket("not-a-real-ticket")).toBeNull();
  });

  it("rejects an expired ticket and still consumes it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { ticket, expiresAt } = mintWsTicket({ orgId: "org-1", userId: "user-1" });
    expect(expiresAt).toBe(60_000);

    vi.setSystemTime(60_001);
    expect(redeemWsTicket(ticket)).toBeNull();
    // Consumed even though expired — redeeming again must not succeed either.
    vi.setSystemTime(30_000);
    expect(redeemWsTicket(ticket)).toBeNull();
    vi.useRealTimers();
  });

  it("mints distinct, unguessable tickets", () => {
    const a = mintWsTicket({ orgId: "org-1", userId: "user-1" });
    const b = mintWsTicket({ orgId: "org-1", userId: "user-1" });
    expect(a.ticket).not.toBe(b.ticket);
    expect(a.ticket.length).toBeGreaterThan(20);
  });

  it("supports an anonymous embed ticket (null userId) with a pinnedAvatarId", () => {
    const { ticket } = mintWsTicket({ orgId: "org-1", userId: null, pinnedAvatarId: "avatar-1" });
    expect(redeemWsTicket(ticket)).toEqual({ orgId: "org-1", userId: null, pinnedAvatarId: "avatar-1" });
  });

  it("omits pinnedAvatarId for a normal authenticated ticket", () => {
    const { ticket } = mintWsTicket({ orgId: "org-1", userId: "user-1" });
    expect(redeemWsTicket(ticket)?.pinnedAvatarId).toBeUndefined();
  });
});
