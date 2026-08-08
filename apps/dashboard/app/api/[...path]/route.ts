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
    init.body = await request.text();
  }

  const upstream = await fetch(url, init);
  const body = await upstream.text();

  const response = new NextResponse(body, {
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
