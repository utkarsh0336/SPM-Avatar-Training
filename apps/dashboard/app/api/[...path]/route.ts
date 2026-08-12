import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  const url = `${API_URL}/v1/${path.join("/")}`;

  // Only forward content-type when the inbound request actually has one —
  // defaulting to application/json unconditionally makes Fastify reject a
  // genuinely empty body (e.g. POST /auth/logout) with a 400.
  const headers: Record<string, string> = { cookie: request.headers.get("cookie") ?? "" };
  const contentType = request.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    // arrayBuffer(), not text(): a UTF-8 decode/re-encode round trip is
    // lossy for arbitrary binary bytes (e.g. a multipart/form-data PDF
    // upload — see apps/api/src/routes/knowledge.ts), silently corrupting
    // the body. ArrayBuffer is a binary-safe passthrough for both JSON/text
    // and binary bodies alike, and (unlike a stream body) needs no `duplex`
    // option since it's already fully buffered in memory.
    init.body = await request.arrayBuffer();
  }

  const upstream = await fetch(url, init);
  const body = await upstream.text();

  // The Fetch spec forbids a body on null-body statuses (204/205/304) —
  // constructing NextResponse with even an empty string throws
  // "Response with null body status cannot have body", which was silently
  // turning a successful 204 DELETE (see apps/api/src/routes/knowledge.ts)
  // into a 500 from this proxy's own perspective, while the delete itself
  // had already succeeded upstream. Found via manual verification, not a
  // guess — see .claude/specs/knowledge-management.md.
  const NULL_BODY_STATUSES = new Set([204, 205, 304]);
  const response = new NextResponse(NULL_BODY_STATUSES.has(upstream.status) ? null : body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });

  // A naive single-header copy drops/mangles multiple Set-Cookie values —
  // getSetCookie() + individual append() is required.
  for (const setCookie of upstream.headers.getSetCookie()) {
    response.headers.append("set-cookie", setCookie);
  }

  return response;
}

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path);
}
