import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { postLoginRedirectTarget, type AuthUser } from "../../../../../lib/api-client";

export const runtime = "nodejs";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

interface GoogleCallbackBody {
  user: AuthUser;
}

function statesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function oauthFailure(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL("/login?error=oauth_failed", request.url));
  response.cookies.delete("oauth_state");
  response.cookies.delete("oauth_verifier");
  return response;
}

/**
 * The browser-facing hop of the OAuth dance — not the generic
 * app/api/[...path]/route.ts catch-all (see app/api/auth/google/route.ts's
 * doc-comment for why). Validates `state` against this same origin's own
 * oauth_state cookie (CSRF protection for the redirect-based flow), then
 * exchanges the code server-to-server with apps/api, relays its Set-Cookie
 * exactly like the catch-all proxy does, and redirects based on onboarding
 * status. See .claude/specs/google-login.md.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = request.cookies.get("oauth_state")?.value;
  const codeVerifier = request.cookies.get("oauth_verifier")?.value;

  if (!code || !state || !storedState || !codeVerifier || !statesMatch(state, storedState)) {
    return oauthFailure(request);
  }

  const upstream = await fetch(`${API_URL}/v1/auth/google/callback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, codeVerifier }),
  });

  // console.log("Status:", upstream.status);

  // const body1 = await upstream.text();
  // console.log("Response:", body1);


  if (!upstream.ok) {
    return oauthFailure(request);
  }

  const body = (await upstream.json()) as GoogleCallbackBody;
  const target = postLoginRedirectTarget(body.user);

  const response = NextResponse.redirect(new URL(target, request.url));
  // A naive single-header copy drops/mangles multiple Set-Cookie values —
  // getSetCookie() + individual append() is required, same as the generic
  // proxy in app/api/[...path]/route.ts.
  for (const setCookie of upstream.headers.getSetCookie()) {
    response.headers.append("set-cookie", setCookie);
  }
  response.cookies.delete("oauth_state");
  response.cookies.delete("oauth_verifier");
  return response;
}
