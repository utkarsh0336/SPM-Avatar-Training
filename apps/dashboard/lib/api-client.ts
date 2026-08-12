import { z } from "zod";
// Sub-path import, not the root "@avatrain/shared" barrel — that barrel
// also re-exports server-only modules (argon2 password hashing, echogarden
// TTS → onnxruntime-node's native binaries), which webpack cannot bundle
// for the browser. Mirrors the existing "@avatrain/shared/tutor" pattern
// used elsewhere in this file. See packages/shared/package.json's exports.
import {
  onboardingCompleteResponseSchema,
  onboardingDraftResponseSchema,
  type OnboardingCompleteResponse,
  type OnboardingDraftInput,
  type OnboardingDraftResponse,
} from "@avatrain/shared/onboarding";
import { orgBrandingResultSchema, type OrgBrandingUpdateInput } from "@avatrain/shared/org";

export interface AuthUser {
  id: string;
  email: string;
  onboardingCompletedAt: string | null;
}

export interface AuthOrg {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColorHex: string | null;
  secondaryColorHex: string | null;
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
  fields?: { path: string; message: string }[];
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

/**
 * Shared post-login redirect gate, used by every login path (password
 * login, signup, and the Google OAuth callback route) so onboarding status
 * is checked consistently rather than each entry point hardcoding its own
 * target. See .claude/specs/google-login.md's UI Changes.
 */
export function postLoginRedirectTarget(user: AuthUser): string {
  return user.onboardingCompletedAt ? "/" : "/onboarding/1";
}

const conversationTicketResultSchema = z.object({
  ticket: z.string(),
  expiresAt: z.number(),
});
export type ConversationTicketResult = z.infer<typeof conversationTicketResultSchema>;

/**
 * Mints a short-lived, single-use ticket for the WS conversation route —
 * this REST call goes through the dashboard's own /api proxy (carrying the
 * session cookie), but the WS connection itself must go directly to
 * apps/api (Next.js Route Handlers can't upgrade to WebSocket), which can't
 * carry that cookie. The ticket is passed as a query param on the WS URL
 * instead. See useConversationSession.ts.
 */
export async function mintConversationTicket(): Promise<ConversationTicketResult> {
  const result = await apiFetch<unknown>("/conversations/ticket", { method: "POST" });
  return conversationTicketResultSchema.parse(result);
}

const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

const simliSessionResultSchema = z.object({
  sessionToken: z.string(),
  iceServers: z.array(iceServerSchema),
});
export type SimliSessionResult = z.infer<typeof simliSessionResultSchema>;

/**
 * Mints a short-lived Simli session_token + ICE servers server-side (apps/api
 * holds SIMLI_API_KEY) — only called when NEXT_PUBLIC_AVATAR_PROVIDER=simli
 * is configured; 503s otherwise. Both must travel together: SimliClient's
 * default P2P transport throws "Ice Servers Required for P2P Mode" without
 * them (confirmed against a live session). See useConversationSession.ts and
 * .claude/specs/avatar-builder-customization.md.
 */
export async function mintSimliSession(): Promise<SimliSessionResult> {
  const result = await apiFetch<unknown>("/conversations/simli-session", { method: "POST" });
  return simliSessionResultSchema.parse(result);
}

/** GET /v1/onboarding — get-or-create semantics, always returns a draft. */
export async function getOnboardingDraft(): Promise<OnboardingDraftResponse> {
  const result = await apiFetch<unknown>("/onboarding", { method: "GET" });
  return onboardingDraftResponseSchema.parse(result);
}

/** PATCH /v1/onboarding — partial update, any subset of OnboardingDraftInput's fields. */
export async function patchOnboardingDraft(
  patch: OnboardingDraftInput,
): Promise<OnboardingDraftResponse> {
  const result = await apiFetch<unknown>("/onboarding", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return onboardingDraftResponseSchema.parse(result);
}

/** POST /v1/onboarding/complete — validates and finalizes the draft into an ACTIVE Avatar. */
export async function completeOnboarding(): Promise<OnboardingCompleteResponse> {
  const result = await apiFetch<unknown>("/onboarding/complete", { method: "POST" });
  return onboardingCompleteResponseSchema.parse(result);
}

/** PATCH /v1/org/branding — OWNER only, 403s otherwise. Partial update: any
 * subset of OrgBrandingUpdateInput's fields. See
 * .claude/specs/tenant-branding.md. */
export async function updateOrgBranding(patch: OrgBrandingUpdateInput): Promise<AuthOrg> {
  const result = await apiFetch<unknown>("/org/branding", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return orgBrandingResultSchema.parse(result);
}
