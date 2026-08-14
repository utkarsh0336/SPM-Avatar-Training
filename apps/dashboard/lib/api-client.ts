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
import {
  knowledgeDocumentSchema,
  knowledgeSearchResponseSchema,
  listKnowledgeDocumentsResponseSchema,
  listKnowledgeDocumentVersionsResponseSchema,
  uploadKnowledgeDocumentResponseSchema,
  uploadKnowledgeDocumentVersionResponseSchema,
  type KnowledgeDocumentResult,
  type KnowledgeSearchResponse,
  type ListKnowledgeDocumentsResponse,
  type ListKnowledgeDocumentVersionsResponse,
  type UpdateKnowledgeDocumentInput,
  type UploadKnowledgeDocumentResponse,
  type UploadKnowledgeDocumentVersionResponse,
} from "@avatrain/shared/knowledge";
import {
  checklistResultSchema,
  completeChecklistItemResponseSchema,
  createChecklistResponseSchema,
  createCurriculumResponseSchema,
  curriculumSchema,
  listAvatarsResponseSchema,
  listCurriculumProgressResponseSchema,
  replaceChecklistItemsResponseSchema,
  replaceCurriculumObjectivesResponseSchema,
  type ChecklistItemInput,
  type ChecklistResult,
  type CompleteChecklistItemResponse,
  type CreateChecklistResponse,
  type CreateCurriculumRequest,
  type CreateCurriculumResponse,
  type CurriculumResult,
  type ListAvatarsResponse,
  type ListCurriculumProgressResponse,
  type ObjectiveInput,
  type ReplaceChecklistItemsResponse,
  type ReplaceCurriculumObjectivesResponse,
  type UpdateCurriculumRequest,
} from "@avatrain/shared/curriculum";
import {
  listMyAvatarsResponseSchema,
  getAvatarResponseSchema,
  type ListMyAvatarsResponse,
  type AvatarRecord,
} from "@avatrain/shared/avatar";
import {
  listApplicationsResponseSchema,
  getApplicationResponseSchema,
  type ListApplicationsResponse,
  type ApplicationRecord,
  type CreateApplicationRequest,
  type UpdateApplicationRequest,
} from "@avatrain/shared/application";

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

export interface ListKnowledgeDocumentsFilter {
  category?: string;
  tags?: string[];
}

/**
 * GET /v1/knowledge/documents — OWNER only. See
 * .claude/specs/knowledge-management.md. Filters are supported server-side
 * (see apps/api/src/routes/knowledge.ts), but KnowledgeBase.tsx fetches the
 * full unfiltered list and filters client-side instead — that keeps the
 * filter dropdown's option set from narrowing to only what's currently
 * visible, and document counts here are small enough that this is fine.
 */
export async function listKnowledgeDocuments(
  filter: ListKnowledgeDocumentsFilter = {},
): Promise<ListKnowledgeDocumentsResponse> {
  const params = new URLSearchParams();
  if (filter.category) params.set("category", filter.category);
  for (const tag of filter.tags ?? []) params.append("tag", tag);
  const query = params.toString();
  const result = await apiFetch<unknown>(`/knowledge/documents${query ? `?${query}` : ""}`, { method: "GET" });
  return listKnowledgeDocumentsResponseSchema.parse(result);
}

export interface UploadKnowledgeDocumentOptions {
  category?: string;
  tags?: string[];
}

/**
 * POST /v1/knowledge/documents — multipart upload. Bypasses apiFetch: the
 * browser sets the multipart boundary itself from a FormData body, which
 * apiFetch's unconditional `Content-Type: application/json` would break.
 */
export async function uploadKnowledgeDocument(
  file: File,
  options: UploadKnowledgeDocumentOptions = {},
): Promise<UploadKnowledgeDocumentResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (options.category) formData.append("category", options.category);
  if (options.tags?.length) formData.append("tags", JSON.stringify(options.tags));
  const response = await fetch("/api/knowledge/documents", { method: "POST", body: formData });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "unknown_error" }))) as ApiErrorBody;
    throw new ApiError(response.status, body);
  }
  return uploadKnowledgeDocumentResponseSchema.parse(await response.json());
}

/** PATCH /v1/knowledge/documents/:id — partial category/tags update. */
export async function updateKnowledgeDocument(
  documentId: string,
  patch: UpdateKnowledgeDocumentInput,
): Promise<KnowledgeDocumentResult> {
  const result = await apiFetch<unknown>(`/knowledge/documents/${documentId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return knowledgeDocumentSchema.parse(result);
}

/**
 * POST /v1/knowledge/documents/:id/versions — multipart upload of the next
 * version in an existing document's lineage. Same FormData/apiFetch-bypass
 * reasoning as uploadKnowledgeDocument.
 */
export async function uploadKnowledgeDocumentVersion(
  documentId: string,
  file: File,
  title?: string,
): Promise<UploadKnowledgeDocumentVersionResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);
  const response = await fetch(`/api/knowledge/documents/${documentId}/versions`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "unknown_error" }))) as ApiErrorBody;
    throw new ApiError(response.status, body);
  }
  return uploadKnowledgeDocumentVersionResponseSchema.parse(await response.json());
}

/** GET /v1/knowledge/documents/:id/versions — full version history, newest first. */
export async function listKnowledgeDocumentVersions(documentId: string): Promise<ListKnowledgeDocumentVersionsResponse> {
  const result = await apiFetch<unknown>(`/knowledge/documents/${documentId}/versions`, { method: "GET" });
  return listKnowledgeDocumentVersionsResponseSchema.parse(result);
}

/** POST /v1/knowledge/documents/:id/versions/:versionId/restore. */
export async function restoreKnowledgeDocumentVersion(
  documentId: string,
  versionId: string,
): Promise<KnowledgeDocumentResult> {
  const result = await apiFetch<unknown>(`/knowledge/documents/${documentId}/versions/${versionId}/restore`, {
    method: "POST",
  });
  return knowledgeDocumentSchema.parse(result);
}

/**
 * DELETE /v1/knowledge/documents/:id — 204 No Content on success. Bypasses
 * apiFetch, which always calls response.json() — parsing an empty 204 body
 * as JSON throws.
 */
export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  const response = await fetch(`/api/knowledge/documents/${documentId}`, { method: "DELETE" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "unknown_error" }))) as ApiErrorBody;
    throw new ApiError(response.status, body);
  }
}

/** GET /v1/knowledge/search — OWNER only. See .claude/specs/knowledge-search-and-ingestion-queue.md. */
export async function searchKnowledge(q: string, topK?: number): Promise<KnowledgeSearchResponse> {
  const params = new URLSearchParams({ q });
  if (topK !== undefined) params.set("topK", String(topK));
  const result = await apiFetch<unknown>(`/knowledge/search?${params.toString()}`, { method: "GET" });
  return knowledgeSearchResponseSchema.parse(result);
}

export type { KnowledgeDocumentResult, KnowledgeSearchResponse, UpdateKnowledgeDocumentInput };
export type { KnowledgeDocumentVersionResult } from "@avatrain/shared/knowledge";

/** GET /v1/avatars — OWNER only. See .claude/specs/interactive-assessment.md. */
export async function listActiveAvatars(): Promise<ListAvatarsResponse> {
  const result = await apiFetch<unknown>("/avatars", { method: "GET" });
  return listAvatarsResponseSchema.parse(result);
}

/**
 * GET /v1/avatars/mine — every avatar the caller has created, ACTIVE first.
 * Replaces the old localStorage onboarding handoff as the source of truth
 * for a live session's persona (useConversationSession.ts) — see
 * .claude/specs/avatar-builder-customization.md's Implementation
 * Assumptions #5.
 */
export async function getMyAvatars(): Promise<ListMyAvatarsResponse> {
  const result = await apiFetch<unknown>("/avatars/mine", { method: "GET" });
  return listMyAvatarsResponseSchema.parse(result);
}

/** GET /v1/avatars/:avatarId — any org member. 404s if the id doesn't exist or belongs to another org. */
export async function getAvatar(avatarId: string): Promise<AvatarRecord> {
  const result = await apiFetch<unknown>(`/avatars/${avatarId}`, { method: "GET" });
  return getAvatarResponseSchema.parse(result).avatar;
}

/** GET /v1/avatars/all — OWNER only. Every avatar in the org, any status — powers the persona management page. */
export async function listOrgAvatars(): Promise<ListMyAvatarsResponse> {
  const result = await apiFetch<unknown>("/avatars/all", { method: "GET" });
  return listMyAvatarsResponseSchema.parse(result);
}

/** POST /v1/avatars — OWNER only. Creates a blank DRAFT persona, ungated by onboarding's one-time-completion check. */
export async function createAvatar(name?: string): Promise<AvatarRecord> {
  const result = await apiFetch<unknown>("/avatars", { method: "POST", body: JSON.stringify(name ? { name } : {}) });
  return getAvatarResponseSchema.parse(result).avatar;
}

/** PATCH /v1/avatars/:avatarId — OWNER only. Partial update, any subset of OnboardingDraftInput's fields. */
export async function updateAvatar(avatarId: string, patch: OnboardingDraftInput): Promise<AvatarRecord> {
  const result = await apiFetch<unknown>(`/avatars/${avatarId}`, { method: "PATCH", body: JSON.stringify(patch) });
  return getAvatarResponseSchema.parse(result).avatar;
}

/** POST /v1/avatars/:avatarId/publish — OWNER only. Validates completeness and sets status ACTIVE (works from DRAFT or ARCHIVED). */
export async function publishAvatar(avatarId: string): Promise<AvatarRecord> {
  const result = await apiFetch<unknown>(`/avatars/${avatarId}/publish`, { method: "POST" });
  return getAvatarResponseSchema.parse(result).avatar;
}

/** POST /v1/avatars/:avatarId/archive — OWNER only. Soft-delete: sets status ARCHIVED, preserving any attached Curriculum. */
export async function archiveAvatar(avatarId: string): Promise<AvatarRecord> {
  const result = await apiFetch<unknown>(`/avatars/${avatarId}/archive`, { method: "POST" });
  return getAvatarResponseSchema.parse(result).avatar;
}

/** GET /v1/applications — OWNER only. Every embed configuration for the org. */
export async function listApplications(): Promise<ListApplicationsResponse> {
  const result = await apiFetch<unknown>("/applications", { method: "GET" });
  return listApplicationsResponseSchema.parse(result);
}

/** POST /v1/applications — OWNER only. */
export async function createApplication(input: CreateApplicationRequest): Promise<ApplicationRecord> {
  const result = await apiFetch<unknown>("/applications", { method: "POST", body: JSON.stringify(input) });
  return getApplicationResponseSchema.parse(result).application;
}

/** PATCH /v1/applications/:applicationId — OWNER only. Partial update. */
export async function updateApplication(applicationId: string, patch: UpdateApplicationRequest): Promise<ApplicationRecord> {
  const result = await apiFetch<unknown>(`/applications/${applicationId}`, { method: "PATCH", body: JSON.stringify(patch) });
  return getApplicationResponseSchema.parse(result).application;
}

/** DELETE /v1/applications/:applicationId — OWNER only. 204 No Content on success. */
export async function deleteApplication(applicationId: string): Promise<void> {
  const response = await fetch(`/api/applications/${applicationId}`, { method: "DELETE" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "unknown_error" }))) as ApiErrorBody;
    throw new ApiError(response.status, body);
  }
}

/** POST /v1/curricula — OWNER only. 409s if the avatar already has a curriculum. */
export async function createCurriculum(input: CreateCurriculumRequest): Promise<CreateCurriculumResponse> {
  const result = await apiFetch<unknown>("/curricula", { method: "POST", body: JSON.stringify(input) });
  return createCurriculumResponseSchema.parse(result);
}

/** GET /v1/curricula/:id — curriculum + ordered objectives. */
export async function getCurriculum(curriculumId: string): Promise<CurriculumResult> {
  const result = await apiFetch<unknown>(`/curricula/${curriculumId}`, { method: "GET" });
  return curriculumSchema.parse(result);
}

/** PATCH /v1/curricula/:id — OWNER only. Partial update: title and/or programType. */
export async function updateCurriculum(curriculumId: string, patch: UpdateCurriculumRequest): Promise<CurriculumResult> {
  const result = await apiFetch<unknown>(`/curricula/${curriculumId}`, { method: "PATCH", body: JSON.stringify(patch) });
  return curriculumSchema.parse(result);
}

/** PUT /v1/curricula/:id/objectives — replace-the-whole-list semantics. */
export async function replaceCurriculumObjectives(
  curriculumId: string,
  objectives: ObjectiveInput[],
): Promise<ReplaceCurriculumObjectivesResponse> {
  const result = await apiFetch<unknown>(`/curricula/${curriculumId}/objectives`, {
    method: "PUT",
    body: JSON.stringify({ objectives }),
  });
  return replaceCurriculumObjectivesResponseSchema.parse(result);
}

/**
 * DELETE /v1/curricula/:id — 204 No Content on success. Bypasses apiFetch,
 * which always calls response.json() — parsing an empty 204 body as JSON
 * throws.
 */
export async function deleteCurriculum(curriculumId: string): Promise<void> {
  const response = await fetch(`/api/curricula/${curriculumId}`, { method: "DELETE" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "unknown_error" }))) as ApiErrorBody;
    throw new ApiError(response.status, body);
  }
}

/**
 * GET /v1/curricula/:id/checklist — any authenticated org member. Returns
 * null (not a thrown ApiError) for the common "no checklist authored yet"
 * case, so callers get a single truthiness check, same convention as
 * curriculum-service.ts's own getCurriculumForAvatar. See
 * .claude/specs/induction-checklist.md.
 */
export async function getChecklist(curriculumId: string): Promise<ChecklistResult | null> {
  try {
    const result = await apiFetch<unknown>(`/curricula/${curriculumId}/checklist`, { method: "GET" });
    return checklistResultSchema.parse(result);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** POST /v1/curricula/:id/checklist — OWNER only. 409s if one already exists. */
export async function createChecklist(curriculumId: string, title: string): Promise<CreateChecklistResponse> {
  const result = await apiFetch<unknown>(`/curricula/${curriculumId}/checklist`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return createChecklistResponseSchema.parse(result);
}

/** PUT /v1/curricula/:id/checklist/items — OWNER only. Replace-the-whole-list semantics. */
export async function replaceChecklistItems(
  curriculumId: string,
  items: ChecklistItemInput[],
): Promise<ReplaceChecklistItemsResponse> {
  const result = await apiFetch<unknown>(`/curricula/${curriculumId}/checklist/items`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
  return replaceChecklistItemsResponseSchema.parse(result);
}

/**
 * DELETE /v1/curricula/:id/checklist — OWNER only. 204 No Content. Bypasses
 * apiFetch, same reasoning as deleteCurriculum.
 */
export async function deleteChecklist(curriculumId: string): Promise<void> {
  const response = await fetch(`/api/curricula/${curriculumId}/checklist`, { method: "DELETE" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "unknown_error" }))) as ApiErrorBody;
    throw new ApiError(response.status, body);
  }
}

/** PATCH /v1/checklist-items/:itemId/complete — any authenticated org member, own progress only. */
export async function completeChecklistItem(itemId: string, completed: boolean): Promise<CompleteChecklistItemResponse> {
  const result = await apiFetch<unknown>(`/checklist-items/${itemId}/complete`, {
    method: "PATCH",
    body: JSON.stringify({ completed }),
  });
  return completeChecklistItemResponseSchema.parse(result);
}

/** GET /v1/curricula/:id/progress */
export async function listCurriculumProgress(curriculumId: string): Promise<ListCurriculumProgressResponse> {
  const result = await apiFetch<unknown>(`/curricula/${curriculumId}/progress`, { method: "GET" });
  return listCurriculumProgressResponseSchema.parse(result);
}
