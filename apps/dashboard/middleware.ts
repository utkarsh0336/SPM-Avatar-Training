import { NextResponse, type NextRequest } from "next/server";

// Duplicated by value (not imported) from apps/api/src/lib/cookies.ts —
// middleware.ts runs on the Edge runtime and must never import
// @avatrain/shared, since that barrel transitively pulls in @prisma/client
// via db/client.ts, which isn't Edge-safe.
const SESSION_COOKIE_NAME = "avatrain_session";

/**
 * Presence-only check for a fast redirect — a UX nicety, not the security
 * boundary. The authoritative check is apps/api's authenticate preHandler,
 * enforced server-side by (dashboard)/layout.tsx's GET /v1/auth/me call.
 */
export function middleware(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|signup|accept-invite|api/auth|auth/|_next/static|_next/image|favicon.ico).*)"],
};
