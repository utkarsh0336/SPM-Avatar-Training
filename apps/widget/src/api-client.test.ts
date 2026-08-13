import { describe, expect, it } from "vitest";
import { EmbedApiError, getEmbedConfig, mintEmbedTicket } from "./api-client.js";

describe("api-client", () => {
  it("exports the embed API functions", () => {
    expect(typeof getEmbedConfig).toBe("function");
    expect(typeof mintEmbedTicket).toBe("function");
  });

  it("EmbedApiError carries status and code", () => {
    const err = new EmbedApiError(404, "not_found");
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
    expect(err.name).toBe("EmbedApiError");
  });
});
