import { describe, expect, it } from "vitest";
import AcceptInvitePage from "./page";

describe("accept-invite page", () => {
  it("exports a page component", () => {
    expect(typeof AcceptInvitePage).toBe("function");
  });
});
