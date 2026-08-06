import { OAuth2Client } from "google-auth-library";

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Only ever called from apps/api; never bundle into apps/dashboard —
 * GOOGLE_CLIENT_SECRET must not reach the browser. See
 * .claude/specs/google-login.md's Implementation Rules.
 */
function getGoogleConfig(): GoogleConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google OAuth is not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/**
 * Verifies a Google ID token's signature, issuer, audience, and expiry
 * (all handled internally by google-auth-library against Google's JWKS) and
 * returns the profile fields the account-resolution logic needs.
 * emailVerified must be checked by the caller before trusting `email` for
 * account linking — see .claude/specs/google-login.md's account-resolution
 * rules.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const config = getGoogleConfig();
  const client = new OAuth2Client(config.clientId);
  const ticket = await client.verifyIdToken({ idToken, audience: config.clientId });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error("invalid_google_id_token");
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: payload.name,
  };
}

/**
 * Exchanges an authorization code (+ PKCE verifier) for Google's tokens and
 * returns the verified profile from the returned ID token. redirectUri is
 * read from this process's own env, never from the caller — it must match
 * the value used when apps/dashboard built the authorization URL, or Google
 * rejects the exchange.
 */
export async function exchangeGoogleCode(code: string, codeVerifier: string): Promise<GoogleProfile> {
  const config = getGoogleConfig();
  const client = new OAuth2Client(config);
  const { tokens } = await client.getToken({
    code,
    codeVerifier,
    redirect_uri: config.redirectUri,
  });
  if (!tokens.id_token) {
    throw new Error("google_token_exchange_failed");
  }
  return verifyGoogleIdToken(tokens.id_token);
}
