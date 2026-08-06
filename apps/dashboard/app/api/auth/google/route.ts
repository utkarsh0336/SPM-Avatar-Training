import { NextResponse, type NextRequest } from "next/server";
import { generatePkcePair, generateState } from "../../../../lib/oauth-pkce";

export const runtime = "nodejs";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_COOKIE_MAX_AGE_SECONDS = 5 * 60;

function oauthCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
    secure: process.env.NODE_ENV === "production",
  };
}

/**
 * Not part of the generic app/api/[...path]/route.ts catch-all proxy — that
 * proxy's server-side fetch() follows redirects itself, which would prevent
 * the browser from ever reaching Google's consent screen. This route issues
 * a real NextResponse.redirect() instead. See .claude/specs/google-login.md.
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.redirect(new URL("/login?error=oauth_not_configured", request.url));
  }

  const state = generateState();
  const { codeVerifier, codeChallenge } = generatePkcePair();

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("oauth_state", state, oauthCookieOptions(OAUTH_COOKIE_MAX_AGE_SECONDS));
  response.cookies.set(
    "oauth_verifier",
    codeVerifier,
    oauthCookieOptions(OAUTH_COOKIE_MAX_AGE_SECONDS),
  );
  return response;
}
