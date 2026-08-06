import { createHash, randomBytes } from "node:crypto";

export function generateState(): string {
  return randomBytes(32).toString("base64url");
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

/** RFC 7636 S256: challenge = BASE64URL(SHA256(verifier)). */
export function generatePkcePair(): PkcePair {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}
