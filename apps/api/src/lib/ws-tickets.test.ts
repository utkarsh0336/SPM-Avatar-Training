import { describe, expect, it, vi } from "vitest";
import { createRedisSingleUseTicketStore, type SingleUseTicketStore } from "@avatrain/shared";
import { mintWsTicket, redeemWsTicket } from "./ws-tickets.js";

describe("ws-tickets", () => {
  it("mints a ticket that redeems to the original claims", async () => {
    const { ticket } = await mintWsTicket({ orgId: "org-1", userId: "user-1" });
    expect(await redeemWsTicket(ticket)).toEqual({ orgId: "org-1", userId: "user-1" });
  });

  it("is single-use — a second redemption of the same ticket fails", async () => {
    const { ticket } = await mintWsTicket({ orgId: "org-1", userId: "user-1" });
    await redeemWsTicket(ticket);
    expect(await redeemWsTicket(ticket)).toBeNull();
  });

  it("rejects an unknown ticket", async () => {
    expect(await redeemWsTicket("not-a-real-ticket")).toBeNull();
  });

  it("rejects an expired ticket and still consumes it", async () => {
    let now = 0;
    const clock = () => now;

    const { ticket, expiresAt } = await mintWsTicket({ orgId: "org-1", userId: "user-1" }, { now: clock });
    expect(expiresAt).toBe(60_000);

    now = 60_001;
    expect(await redeemWsTicket(ticket, { now: clock })).toBeNull();
    // Consumed even though expired — redeeming again must not succeed either.
    now = 30_000;
    expect(await redeemWsTicket(ticket, { now: clock })).toBeNull();
  });

  it("mints distinct, unguessable tickets", async () => {
    const a = await mintWsTicket({ orgId: "org-1", userId: "user-1" });
    const b = await mintWsTicket({ orgId: "org-1", userId: "user-1" });
    expect(a.ticket).not.toBe(b.ticket);
    expect(a.ticket.length).toBeGreaterThan(20);
  });

  it("supports an anonymous embed ticket (null userId) with a pinnedAvatarId", async () => {
    const { ticket } = await mintWsTicket({ orgId: "org-1", userId: null, pinnedAvatarId: "avatar-1" });
    expect(await redeemWsTicket(ticket)).toEqual({ orgId: "org-1", userId: null, pinnedAvatarId: "avatar-1" });
  });

  it("omits pinnedAvatarId for a normal authenticated ticket", async () => {
    const { ticket } = await mintWsTicket({ orgId: "org-1", userId: "user-1" });
    expect((await redeemWsTicket(ticket))?.pinnedAvatarId).toBeUndefined();
  });

  it("survives a mint and redeem going through independent store instances — simulates two machines", async () => {
    const storeOnMachineA = createRedisSingleUseTicketStore();
    const storeOnMachineB = createRedisSingleUseTicketStore();

    const { ticket } = await mintWsTicket({ orgId: "org-1", userId: "user-1" }, { store: storeOnMachineA });
    expect(await redeemWsTicket(ticket, { store: storeOnMachineB })).toEqual({
      orgId: "org-1",
      userId: "user-1",
      pinnedAvatarId: undefined,
    });

    await storeOnMachineA.close();
    await storeOnMachineB.close();
  });

  it("fails closed — a broken store makes redemption fail, never succeed, as if the ticket were invalid", async () => {
    const brokenStore: SingleUseTicketStore = {
      put: vi.fn().mockRejectedValue(new Error("connection refused")),
      takeOnce: vi.fn().mockRejectedValue(new Error("connection refused")),
      close: vi.fn().mockResolvedValue(undefined),
    };

    await expect(redeemWsTicket("some-ticket", { store: brokenStore })).resolves.toBeNull();
  });
});
