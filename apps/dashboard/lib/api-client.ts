export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthOrg {
  id: string;
  name: string;
}

export type AuthRole = "OWNER" | "MEMBER";

export interface AuthResult {
  user: AuthUser;
  org: AuthOrg;
  role: AuthRole;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message ?? body.error);
    this.name = "ApiError";
  }
}

/** Browser-side calls always hit the dashboard's own same-origin /api/*
 * proxy (apps/dashboard/app/api/[...path]/route.ts) — never apps/api
 * directly, so there's no cross-origin request in this design. */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Only send Content-Type when there's a body — Fastify's JSON body parser
  // rejects an empty body sent with application/json (logout has none).
  const headers = init?.body
    ? { "Content-Type": "application/json", ...init?.headers }
    : init?.headers;

  const response = await fetch(`/api${path}`, { ...init, headers });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "unknown_error" }))) as ApiErrorBody;
    throw new ApiError(response.status, body);
  }

  return response.json() as Promise<T>;
}

export function login(email: string, password: string): Promise<AuthResult> {
  return apiFetch<AuthResult>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function signup(orgName: string, email: string, password: string): Promise<AuthResult> {
  return apiFetch<AuthResult>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ orgName, email, password }),
  });
}

export function acceptInvite(token: string, password: string): Promise<AuthResult> {
  return apiFetch<AuthResult>("/auth/accept-invite", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>("/auth/logout", { method: "POST" });
}
