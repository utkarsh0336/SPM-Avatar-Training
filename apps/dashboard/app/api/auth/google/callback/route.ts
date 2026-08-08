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

function oauthFailure(request: NextRequest, reason: string): NextResponse {
  // Logged server-side only (this Route Handler runs in Node, never in the
  // browser) — the user is redirected to a generic error page regardless,
  // but without this the actual cause (e.g. apps/api rejecting the code
  // exchange because GOOGLE_REDIRECT_URI doesn't exactly match what's
  // registered in Google Cloud Console) was previously silent, making this
  // failure mode undebuggable from the outside. See google-login troubleshooting.
  console.error("[google/callback] OAuth failed:", reason);
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
    return oauthFailure(request, "missing or mismatched state/code/verifier");
  }

  const upstream = await fetch(`${API_URL}/v1/auth/google/callback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, codeVerifier }),
  });

  if (!upstream.ok) {
    // apps/api's handler never forwards the underlying Google/gaxios error
    // (see apps/api/src/routes/auth.ts's comment on why), so the most this
    // process ever sees is the generic error code it responded with.
    const body = await upstream.json().catch(() => ({}));
    return oauthFailure(
      request,
      `apps/api responded ${upstream.status}: ${JSON.stringify(body)}`,
    );
  }

  const body = (await upstream.json()) as GoogleCallbackBody;
  const target = postLoginRedirectTarget(body.user);

  const response = NextResponse.redirect(new URL(target, request.url));
  // Clear the PKCE cookies FIRST, before touching set-cookie headers any
  // other way. response.cookies.delete() goes through Next's ResponseCookies
  // wrapper, which maintains its own cookie-name-keyed map and REWRITES the
  // entire set-cookie header list from that map on every mutation — it does
  // not just append a deletion header. Calling it AFTER manually appending
  // the session cookie below (via response.headers.append, which bypasses
  // that wrapper entirely) silently dropped the session cookie from the
  // final response: reproduced live (confirmed via psql — apps/api minted a
  // real session row every time, but the browser's next request had no
  // avatrain_session cookie, so middleware.ts's presence check bounced it
  // back to /login even though the redirect target was correctly computed
  // as /onboarding/1). Doing the deletes first means ResponseCookies only
  // ever sees its own two cookies; the session relay below then always runs
  // last and is never rewritten out from under itself.
  response.cookies.delete("oauth_state");
  response.cookies.delete("oauth_verifier");
  // A naive single-header copy drops/mangles multiple Set-Cookie values —
  // getSetCookie() + individual append() is required, same as the generic
  // proxy in app/api/[...path]/route.ts.
  for (const setCookie of upstream.headers.getSetCookie()) {
    response.headers.append("set-cookie", setCookie);
  }
  return response;
}
