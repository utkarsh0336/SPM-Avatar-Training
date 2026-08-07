import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

// Full DB-backed auth flows are covered by auth.test.ts's established
// pattern; this only checks the parts of this route that don't require a
// live database — the unauthenticated-request rejection (getSessionToken
// returns undefined before any DB lookup happens) and route registration
// itself. WS upgrade behavior (ticket validation on the actual socket
// handshake) is covered by lib/ws-tickets.test.ts's unit tests instead,
// since Fastify's `.inject()` cannot perform a real WS upgrade.
describe("conversation routes", () => {
  it("POST /v1/conversations/ticket without a session cookie returns 401", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/conversations/ticket" });
    expect(response.statusCode).toBe(401);
  });

  it("GET on the ticket route (wrong method) is not found", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/conversations/ticket" });
    expect(response.statusCode).toBe(404);
  });
});
