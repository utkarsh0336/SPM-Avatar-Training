import { randomBytes, createHash } from "node:crypto";

/**
 * Opaque bearer token — 32 random bytes, base64url-encoded. Used for both
 * session cookies and one-time invite links. Only sha256Hex(token) is ever
 * persisted; the raw value exists solely in the Set-Cookie header / the
 * invite-URL response. See .claude/specs/authentication.md.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
