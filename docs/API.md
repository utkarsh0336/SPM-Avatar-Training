# API reference

`apps/api` is a Fastify backend. This document lists every HTTP/WebSocket endpoint it exposes,
in plain language — what it's for, who's allowed to call it, and what you send/get back. For
the "why" behind the architecture, see `docs/HOW_IT_WORKS.md` and `docs/ARCHITECTURE.md`. The
public embed widget's contract (the loader script + postMessage protocol) is documented
separately in `docs/embed-contract.md` — this file covers the HTTP side of that same contract
under **Public embed API** below.

---

## Before you dive in: how auth works here

There are **four different ways** a request can be authenticated, and every endpoint below
states which one it uses:

| Auth kind | How it's sent | Who it identifies | Used by |
|---|---|---|---|
| **Session cookie** | Browser cookie, set on login/signup | A specific user, in a specific org, with a role | The dashboard |
| **Publishable key** | `?key=pk_xxx` query param | Which *customer* (org + pinned avatar), never a specific person | The embedded widget |
| **WS ticket** | `?ticket=...` query param on the WebSocket URL | A single, one-time-use permission to open one conversation | The live voice/video connection, both dashboard and widget |
| **Internal ops token** | `Authorization: Bearer <token>` | Avatrain's own CI, not a customer | Automated uptime/backup checks only |

**Roles.** Every user in an org has exactly one role: `OWNER`, `MEMBER`, or `PARTNER`.
`OWNER` can configure everything (avatars, curricula, knowledge base, embeds, billing-adjacent
settings, analytics). `MEMBER` is a learner — takes training, sees their own progress.
`PARTNER` is a restricted, read-mostly role scoped to curricula specifically tagged for partner
enablement; a `PARTNER` gets a 404 (not a 403) for anything outside that scope, so they can't
even tell it exists.

**Errors.** Every error response is JSON in the same shape:

```json
{ "error": "some_error_code", "message": "human-readable detail", "fields": [ { "path": "email", "message": "required" } ] }
```

`fields` only appears on validation errors (HTTP 400). Standard HTTP status codes are used
throughout (`401` not logged in, `403` logged in but not allowed, `404` not found or not
visible to you, `409` conflict, `503` feature not enabled/configured). Below, only the
*non-obvious* error cases are called out — assume standard 401/403/404 apply unless a route
says otherwise.

**Base path.** Every route is prefixed `/v1/` except the handful of infra-facing ones
(`/status`, `/readyz`, `/metrics`) which are deliberately unversioned, root-level paths that
uptime tooling can hit without knowing anything about the app.

---

## Auth — `/v1/auth/*`

Signup, login, session management, and team invites.

**`POST /v1/auth/signup`** — Auth: none. Creates a brand-new organization plus its first user
(who becomes `OWNER`), and logs them in.
Request: `orgName` (string 1-200), `email` (string), `password` (string 8-200).
Response (201): `{ user: {id, email, onboardingCompletedAt, uiLocale}, org: {id, name}, role }`.
Sets a session cookie.
Notes: rate-limited to 10 signups/min per IP.

**`POST /v1/auth/login`** — Auth: none. Logs an existing user in.
Request: `email`, `password`.
Response (200): same `{user, org, role}` shape as signup. Sets a session cookie.
Notes: rate-limited to 10 attempts/min per email+IP pair.

**`POST /v1/auth/google/callback`** — Auth: none. Exchanges a Google OAuth authorization code
(the dashboard's own backend calls this, never the browser directly) for a session; creates
the user/org on first login.
Request: `code`, `codeVerifier` (PKCE).
Response (200): `{user, org, role}`. Sets a session cookie.
Notes: rate-limited 10/min per IP; a failed Google exchange never leaks the raw provider error
(may contain secrets) — always returns `google_auth_failed`.

**`POST /v1/auth/logout`** — Auth: none (reads whatever session cookie is present, if any).
Ends the session and clears the cookie. Response (200): `{ok: true}`.

**`GET /v1/auth/me`** — Auth: session cookie. The "who am I" check the dashboard runs on every
page load. Response (200): `{user, org, role}`.

**`PATCH /v1/auth/me`** — Auth: session cookie. Updates the caller's own admin-portal display
language (not the avatar's conversation language — that's a separate, per-avatar setting).
Request: `uiLocale: "EN" | "HI"`. Response (200): updated user object.

**`POST /v1/auth/invite`** — Auth: session cookie, `OWNER` only. Invites a teammate by email.
Request: `email`, `role: "MEMBER" | "PARTNER"` (defaults to `MEMBER`; an invite can never grant
`OWNER` — ownership only comes from signup/Google). Response (201): invite result.

**`POST /v1/auth/accept-invite`** — Auth: none (the invite token itself is the credential).
Redeems an invite, setting the invited user's password and logging them in.
Request: `token`, `password`. Response (200): `{user, org, role}`. Sets a session cookie.

**`GET /v1/auth/members`** — Auth: session cookie, `OWNER` only. Lists everyone in the org.
Response (200): `{ members: [{userId, email, role, joinedAt}] }`.

---

## Onboarding — `/v1/onboarding*`

The one-time avatar-builder wizard a trainer completes after signup — a draft filled in step by
step, then finalized into a real avatar.

**`GET /v1/onboarding`** — Auth: session cookie (any role). Fetches the caller's in-progress
draft (creates an empty one if none exists yet). Response (200): name, style, gender,
skinTone, hairStyle, hairColor, outfit, expertise, voice, ageGroup, region,
preferredLanguage, readingLevel, `status: "DRAFT"|"ACTIVE"`, `lastVisitedStep` (1-7), plus
optional 3D-preview fields (`previewProvider`, `externalAvatarId`, `avatarModelUrl`,
`avatarSnapshotUrl`, `previewGeneratedAt`, `simliFaceId`).

**`PATCH /v1/onboarding`** — Auth: session cookie. Saves one or more fields of the draft
(every field optional — the wizard can be filled in any order/partially). Response (200): the
updated draft.

**`POST /v1/onboarding/complete`** — Auth: session cookie. Finalizes the draft into a real,
usable Avatar. Response (200): `{ avatarId }`.
Notes: fails if required fields (name, style, gender, skinTone, hairStyle, hairColor, outfit,
expertise, voice) aren't all filled in — the optional preview fields don't block completion.

---

## Organization — `/v1/org/*`

**`PATCH /v1/org/branding`** — Auth: session cookie, `OWNER` only. Updates the org's display
name, logo, and brand colors (white-labels the widget/dashboard).
Request (all optional — an omitted field is left untouched, not cleared): `name`, `logoUrl`,
`primaryColorHex`/`secondaryColorHex` (6-digit hex like `#8B5CF6`).
Response (200): `{id, name, logoUrl, primaryColorHex, secondaryColorHex}`.
Notes: always applies to the caller's own org — there's no way to pass a different org id.

---

## Applications — `/v1/applications*`

The trainer-facing (dashboard) side of "embed configuration" — an Application row holds a
publishable key, allowed website origins, and which avatar it points to. Separate from the
**Public embed API** below, which is what the *embedded widget itself* calls at runtime.

**`GET /v1/applications`** — Auth: session cookie, `OWNER` only. Lists every embed
configuration for the org. Response (200): `{ applications: [{id, name, publishableKey,
allowedOrigins, avatarId, isEnabled}] }`.

**`POST /v1/applications`** — Auth: session cookie, `OWNER` only. Creates a new embed
configuration (and generates its publishable key). Request: `name` (1-80 chars).
Response (201): `{ application }`.

**`PATCH /v1/applications/:applicationId`** — Auth: session cookie, `OWNER` only. Updates
name, allowed origins (max 20, each an exact origin like `https://example.com`, no
path/wildcard), which avatar is pinned, or enabled/disabled.
Request: any subset of `name`, `allowedOrigins`, `avatarId` (nullable), `isEnabled`.
Response (200): `{ application }`.

**`DELETE /v1/applications/:applicationId`** — Auth: session cookie, `OWNER` only. Deletes an
embed configuration. Response: 204 no content.

---

## Avatars — `/v1/avatars*`

Persona records — a trainer can have multiple named avatars, each with its own
appearance/voice/curriculum.

**`GET /v1/avatars`** — Auth: session cookie, `OWNER` only. Lists the org's published
(`ACTIVE`) avatars — powers the curriculum admin page's avatar picker.
Response (200): `{ avatars: [{id, name, curriculumId, programType}] }`.

**`GET /v1/avatars/mine`** — Auth: session cookie (any role). Lists avatars the caller
personally created. Response (200): `{ avatars }` (same summary shape).

**`GET /v1/avatars/all`** — Auth: session cookie, `OWNER` only. Lists every avatar in the org
regardless of status/creator.

**`GET /v1/avatars/recommended`** — Auth: session cookie (any role). Returns the org's avatar
catalog ranked for the caller, tagged with a `recommendationTier` (`NEEDS_REVIEW`,
`IN_PROGRESS`, `NOT_STARTED`, `COMPLETED`, `NO_CURRICULUM`) based on that learner's own
progress — what a `MEMBER` uses to discover what's available to them.
Response (200): `{ avatars: [{id, name, curriculumId, programType, recommendationTier,
objectiveCount, completedObjectiveCount}] }`.

**`POST /v1/avatars`** — Auth: session cookie, `OWNER` only. Creates a new blank avatar (starts
a second onboarding-style draft under this name). Request: `name` (optional).
Response (201): `{ avatar }`.

**`GET /v1/avatars/:avatarId`** — Auth: session cookie (any role). Fetches one avatar's full
detail. Response (200): `{ avatar }`. 404 `avatar_not_found` if missing or not in the caller's
org.

**`PATCH /v1/avatars/:avatarId`** — Auth: session cookie, `OWNER` only. Edits an avatar's
appearance/persona fields (same shape as the onboarding draft). Response (200): `{ avatar }`.

**`POST /v1/avatars/:avatarId/publish`** — Auth: session cookie, `OWNER` only. Marks an avatar
`ACTIVE` (makes it usable in live sessions/embeds). Response (200): `{ avatar }`.

**`POST /v1/avatars/:avatarId/archive`** — Auth: session cookie, `OWNER` only. Retires an
avatar (soft-delete — preserves its curriculum and learner progress history).
Response (200): `{ avatar }`.

---

## Curriculum — `/v1/curricula*`

What the avatar actually teaches: a curriculum is an ordered list of "objectives" (a teaching
point + a check question + grading criteria), one per avatar.

Read routes (`GET`) allow `OWNER` and `PARTNER`; write routes (create/update/delete/
replace-objectives) are `OWNER`-only. A `PARTNER` only ever sees curricula tagged
`programType: PARTNER_ENABLEMENT` — anything else 404s for them (not 403), so a `PARTNER` can't
even detect that other curricula exist.

**`POST /v1/curricula`** — Creates a curriculum for an avatar.
Request: `avatarId`, `title`, `programType` (optional: `EMPLOYEE_ONBOARDING` |
`COMPLIANCE_TRAINING` | `CUSTOMER_EDUCATION` | `PARTNER_ENABLEMENT`).
Response (201): `{id, avatarId, title, programType}`.

**`GET /v1/curricula`** — Lists curricula visible to the caller.
Response (200): `{ curricula: [{id, avatarId, avatarName, title, programType, objectiveCount,
createdAt, updatedAt}] }`.

**`GET /v1/curricula/:curriculumId`** — Fetches one curriculum with its full objective list
(including any branching scenario steps attached to each objective).
Response (200): full curriculum incl. `adaptiveOrderingEnabled` (if true, a learner's
objectives are presented in mastery-weighted order instead of authored order).

**`PATCH /v1/curricula/:curriculumId`** — Updates title/programType/adaptiveOrderingEnabled.
`programType: null` explicitly clears it back to uncategorized; an omitted field is left
untouched.

**`PUT /v1/curricula/:curriculumId/objectives`** — Replaces the entire objective list in one
call (trainer edits the whole list client-side, saves once). Each item: include `id` to update
an existing objective, omit it to create a new one; array position = display order.
Request: `{ objectives: [{id?, title, teachingContent, checkQuestion, gradingCriteria}] }`
(min 1). Response (200): `{ objectives }` (full saved objects).

**`DELETE /v1/curricula/:curriculumId`** — Deletes a curriculum (204).

**`GET /v1/curricula/:curriculumId/progress`** — Per-learner progress across every objective.
Response (200): `{ progress: [{objectiveId, objectiveTitle, learnerId, learnerEmail, verdict,
attempts, feedback, updatedAt}] }`.

**`GET /v1/curricula/:curriculumId/effectiveness`** — Aggregated stats (completion rate, pass
rate, avg attempts/time-to-competency) built from the same progress rows, for the analytics
dashboard.

---

## Checklist — `/v1/curricula/:curriculumId/checklist*`, `/v1/checklist-items/:itemId/complete`

A simple, non-graded task list attached to a curriculum (e.g. "watch the safety video", "sign
the policy doc") — separate from the AI-graded objectives above.

**`POST /v1/curricula/:curriculumId/checklist`** — Auth: `OWNER`. Creates the checklist (one
per curriculum). Request: `title`. Response (201): `{id, curriculumId, title}`.

**`GET /v1/curricula/:curriculumId/checklist`** — Auth: any authenticated org member. Fetches
the checklist with each item's `completed` flag resolved for the calling user specifically
(completion is self-attested per learner, not shared).

**`PUT /v1/curricula/:curriculumId/checklist/items`** — Auth: `OWNER`. Replaces the whole item
list (same id-present=update / id-absent=create / position=order convention as objectives).
Request: `{ items: [{id?, title, description?}] }` (min 1).

**`DELETE /v1/curricula/:curriculumId/checklist`** — Auth: `OWNER`. Deletes the checklist
(204).

**`PATCH /v1/checklist-items/:itemId/complete`** — Auth: any authenticated org member. A
learner ticks (or unticks) one item for themselves.
Request: `{ completed: boolean }`. Response (200): `{itemId, completed, completedAt}`.

---

## Scenario — `/v1/objectives/:objectiveId/scenario`

Optional branching dialogue tree attached to one objective — lets a checkpoint be a multi-turn
"choose your response" scenario instead of a single Q&A. Applies only when steps are present;
an objective with none falls back to its plain checkQuestion/gradingCriteria.

**`PUT /v1/objectives/:objectiveId/scenario`** — Auth: session cookie, `OWNER` only. Replaces
the objective's entire scenario tree in one call.
Request: `{ steps: [{order, prompt, branches: [{order, matchCriteria, nextStepOrder |
outcome}]}] }` — each branch sets exactly one of `nextStepOrder` (continues to another step,
referenced by its `order` in this same payload) or `outcome` (ends the scenario with a
pass/fail-style verdict). Passing `steps: []` clears the scenario.
Response (200): `{ steps }` (saved, with real ids and `nextStepId` resolved).

---

## Knowledge base — `/v1/knowledge/*`

Upload, version, tag, and search the documents a trainer's knowledge base is built from (PDF,
DOCX, PPTX, XLSX, TXT, CSV, HTML — 25MB max per file). All routes require **OWNER** role.

**`POST /v1/knowledge/documents`** — Upload a new document. Kicks off background
parsing/chunking/embedding (status starts `PENDING`, moves to `PROCESSING` → `INDEXED` or
`FAILED`). Request: multipart form — file part (required) + optional text fields `category`
(string, ≤100 chars) and `tags` (JSON-encoded array of strings, ≤20 tags, ≤50 chars each).
Response (201): `{ id, status }`. Errors: `400 file_too_large`, `400 missing_file`,
`400 invalid_tags`.

**`GET /v1/knowledge/documents`** — List the org's documents, optionally filtered.
Request: query `category?`, `tag?` (repeatable). Response (200): `{ documents: [{id, title,
originalFilename, mimeType, fileSizeBytes, status, errorMessage, chunkCount, category, tags,
version, isLatest, createdAt, updatedAt}] }`.

**`GET /v1/knowledge/documents/:documentId`** — Fetch one document's metadata (same shape as
above).

**`PATCH /v1/knowledge/documents/:documentId`** — Update category/tags only (not the file
itself). Request: `{ category?: string | null, tags?: string[] }` — explicit `null` clears
category; an omitted field leaves it unchanged. Response (200): the updated document.

**`DELETE /v1/knowledge/documents/:documentId`** — Delete a document (and its indexed chunks).
Response: 204.

**`POST /v1/knowledge/documents/:documentId/versions`** — Upload a new version of an existing
document (keeps history rather than overwriting). Request: multipart — file part + optional
`title` text field. Response (201): `{ id, version, status }`.

**`GET /v1/knowledge/documents/:documentId/versions`** — List all versions, newest first.
Response (200): `{ versions: [{id, version, title, originalFilename, fileSizeBytes, status,
chunkCount, isLatest, uploadedById, createdAt}] }`.

**`POST /v1/knowledge/documents/:documentId/versions/:versionId/restore`** — Roll the document
back to a previous version (that version becomes `isLatest`). Response (200): the document, in
its restored state.

**`GET /v1/knowledge/search`** — Ad-hoc semantic search over the org's knowledge base — an
admin tool, not the live-conversation retrieval path (though it calls the identical retrieval
function the avatar uses mid-conversation). Request: query `q` (string, required), `topK?`
(number, 1–20). Response (200): `{ results: [{documentId, title, content, similarity}] }`.

---

## Training sessions — `/v1/training-sessions*`

A "training session" is a **trainer's own rehearsal conversation** with an avatar inside the
dashboard (video-chat or voice-only) — distinct from a real learner's anonymous embed-widget
session, which isn't persisted here (see §"What an anonymous embed session can't do" in
`docs/embed-contract.md`). Every route just requires being logged in (no extra role check).

**`POST /v1/training-sessions`** — Start a new rehearsal session.
Request: `{ kind: "VIDEO_CHAT" | "VOICE_ONLY", title (1–120 chars), topic? (1–200 chars),
avatarId? (uuid), voiceExpertId?, clientRequestId (uuid) }`. `voiceExpertId` is required for
`VOICE_ONLY` and forbidden for `VIDEO_CHAT`; `avatarId` is forbidden for `VOICE_ONLY` (optional
for `VIDEO_CHAT` — omit it to use the caller's own active avatar). `clientRequestId` is an
idempotency key: retrying the same request returns the original session instead of a
duplicate. Response (201): `{ trainingSession: {id, kind, status, title, topic, avatarId,
voiceExpertId, personaName, personaRole, endReason, endedAt, createdAt, updatedAt} }`.

**`GET /v1/training-sessions?kind=`** — List the caller's sessions of a given kind, split into
pinned and recent. Response (200): `{ pinned: [...], recent: [...] }`.

**`GET /v1/training-sessions/:trainingSessionId`** — Fetch one session.

**`GET /v1/training-sessions/:trainingSessionId/messages?after=&limit=`** — Fetch a session's
transcript, oldest-first, keyset-paginated. Request: query `after?` (message sequence cursor),
`limit?` (≤200). Response (200): `{ messages: [{id, role: "USER"|"AVATAR"|"SYSTEM", content,
sequence, createdAt}], nextAfter: number | null }`. There is no `POST .../messages` — messages
are only ever written server-side by the live conversation pipeline, never accepted from a
client body.

**`POST /v1/training-sessions/:trainingSessionId/end`** — End an active session.
Request: `{ reason? (1–200 chars) }`. Response (200): the updated session
(`status: "ENDED"`).

**`PATCH /v1/training-sessions/:trainingSessionId/pin`** — Pin/unpin a session for quick
access. Request: `{ pinned: boolean }`. Response (200): `{ pinned: boolean }`.

---

## Conversations — `/v1/conversations/*`

Mints the short-lived credentials needed to actually start talking to an avatar, plus the live
WebSocket itself — the real-time heart of the product.

**`POST /v1/conversations/ticket`** — Auth: session cookie. Mint a one-time WebSocket
connection ticket (60s TTL) for the default (free) voice/video transport. Response (201):
`{ ticket, expiresAt }`. Rate limit: 20 requests / 5 minutes per user.

**`POST /v1/conversations/simli-session`** — Auth: session cookie. Mint a short-lived session
for the paid Simli photoreal-avatar provider (the browser never sees the Simli API key). Only
usable when Simli is configured for the deployment. Response (201): `{ sessionToken,
iceServers }`. Errors: `503 simli_not_configured`. Rate limit: 10 requests / 5 minutes per user
(tighter than the free ticket — this one costs real money per mint).

**`POST /v1/conversations/:trainingSessionId/livekit-connect`** — Auth: session cookie. Mint
credentials for the enterprise "Mode B" LiveKit video pipeline (a higher-fidelity alternative
transport to the default WebSocket one). Response (201): `{ livekitUrl, roomToken, roomName }`.
Errors: `503 feature_disabled` (LiveKit not enabled for this deployment), `403
plan_not_enterprise` (org isn't on the Enterprise plan), `404 training_session_not_found`,
`409 session_ended`. Rate limit: 10 requests / 5 minutes per user.

**`GET /v1/conversations/:trainingSessionId/ws`** — Auth: single-use ticket via `?ticket=`
query param (not a cookie — browsers can't attach cookies to a cross-origin WebSocket
handshake). Ticket comes from `POST /v1/conversations/ticket`, or from the public embed ticket
route below for anonymous widget visitors.
**This is the actual live conversation** — a WebSocket, not a normal JSON request/response.
Once upgraded, the client streams audio/text turns and receives the avatar's streamed text +
audio + transcript back over the same socket (wire message shapes are a fixed, versioned set —
see `packages/shared/src/realtime/ws-messages.ts`). `:trainingSessionId` is a real uuid for
authenticated dashboard rehearsal (must belong to the caller's org and still be `ACTIVE`), or
is ignored for anonymous embed connections (identified instead by the ticket's pinned avatar).
Errors (before upgrade completes, as a normal 401/404/409): `401 invalid_ticket`,
`404 training_session_not_found`, `409 session_ended`.

---

## Analytics — `/v1/analytics/*`

Org-wide dashboards for usage, training outcomes, AI performance, and learner satisfaction. All
four require **OWNER** role (business-sensitive, same gate as branding settings) and share a
`?days=7|30|90` window param (default varies by route — check response `windowDays`).

> ⚠️ **Important caveat.** `activeUserCount`, `totalConversationCount`,
> `avgSessionDurationSeconds` (usage) and everything under `/training` are computed from
> `TrainingSession`/`ObjectiveProgress`, which only the dashboard's own trainer-rehearsal flows
> write — anonymous public embed-widget conversations aren't persisted, so **these don't
> reflect real end-learner traffic.** Performance and satisfaction numbers, by contrast, **are**
> real org-wide production data (they come from the shared turn pipeline / a real-time WS
> message both surfaces use identically).

**`GET /v1/analytics/usage?days=`** — Response (200): `{ windowDays, generatedAt,
activeUserCount, totalConversationCount, avgSessionDurationSeconds, topKnowledgeAreas:
[{documentId, documentTitle, category, accessCount}] }` (top 10 most-accessed documents — this
one field *is* real org-wide usage).

**`GET /v1/analytics/training`** (no `days` param — all-time) — Response (200): `{ generatedAt,
participantCount, curriculumsWithActivityCount, avgCompletionRate,
avgTimeToCompetencySeconds, knowledgeGaps: [{objectiveId, objectiveTitle, curriculumId,
curriculumTitle, attemptedLearnerCount, passRate}] }` (objectives with the lowest pass rates,
min. 2 attempts, top 10).

**`GET /v1/analytics/performance?days=`** — Response (200): `{ windowDays, generatedAt,
turnCount, avgLatencyMs: {stt, retrieval, llmFirstToken, ttsFirstChunk, total},
groundedReplyRate, knowledgeUtilizationTrend: [{date, accessCount}] }` (one point per day in the
window, zero-filled). ⚠️ `groundedReplyRate` means "the reply cited retrieved knowledge-base
content" — it is **not** a factual-accuracy score.

**`GET /v1/analytics/satisfaction?days=`** — Response (200): `{ windowDays, generatedAt,
ratingCount, avgRating, ratingDistribution: [{rating: 1-5, count}] }` (always 5 entries,
zero-filled). Ratings come exclusively from the public embed widget's 1–5 star prompt.

---

## Public embed API — `/v1/embed/*`

The only routes an embedded widget on a customer's site actually calls at runtime. **No
cookies, no `Authorization` header** — authenticated by a publishable key (`pk_xxx`) as a query
parameter (deliberately not a JSON body, so the request needs no `Content-Type` header and
stays a CORS "simple request" — no preflight). This is a fundamentally different trust model
from `/v1/applications` above (that's the trainer's dashboard managing these same rows over a
real login).

Both routes: 404 if the key doesn't match any Application; 503 `embed_disabled` if the
Application is turned off; 403 `origin_not_allowed` if the request's `Origin` header isn't on
that Application's allowed-origins list (checked server-side — CORS headers alone aren't real
security since only browsers respect them).

**`GET /v1/embed/config?key=pk_xxx`** — Returns the pinned avatar's public persona fields so
the widget knows who it's rendering. Response (200): `{avatarId, avatarName, expertise,
voiceTone, style, gender, outfit, skinTone, hairStyle, hairColor}`. Notes: 503
`embed_not_configured` if no avatar is pinned yet, the pinned avatar isn't published, or it's
missing required fields.

**`POST /v1/embed/ticket?key=pk_xxx`** — Mints a short-lived, single-use WebSocket connection
ticket for starting a training session, scoped to the pinned avatar with `userId: null`
(anonymous — see `docs/embed-contract.md` for what an anonymous session can't do, e.g. progress
never persists). Response (201): `{ticket, expiresAt}`. Notes: rate-limited to 20 requests / 5
minutes per publishable key (tighter than the authenticated dashboard equivalent, since anyone
who can read the embedding page's JS can read the key).

---

## Status, health, and metrics — infra-facing, unversioned paths

**`GET /v1/status`** — Auth: none. JSON status summary: `{ services: [{service, region,
status: "UP"|"DOWN", latencyMs, checkedAt}], incidents: [{title, severity, status, body,
startedAt, resolvedAt}] }`.

**`GET /status`** — Auth: none. Same data as above, rendered as a plain HTML status page for
humans. Both share a 15-second in-memory cache so repeated hits during a real incident don't
hammer the database.

**`GET /healthz`** — Auth: none. Bare liveness check — just confirms the process is up.
Returns `{status: "ok"}` (200) always, with no dependency checks.

**`GET /readyz`** — Auth: none. Readiness probe: checks a real database round-trip and Redis
connectivity, so it can fail even while `/healthz` says the process is alive. Returns
`{status: "ready"}` (200) or `{status: "not_ready", error}` (503).

**`GET /metrics`** — Auth: none. Prometheus text-format scrape endpoint (`text/plain;
version=0.0.4`) for infra monitoring, not app data. Exposes `avatrain_api_up` (always 1) and
`avatrain_api_error_count_total` (5xx count since process start, resets on restart).

---

## Internal ops — `/v1/internal/*`

Not for customers or the dashboard — used only by Avatrain's own CI workflows (synthetic uptime
checks, backup verification) to write platform-level status data. Auth is a single shared
bearer token (`Authorization: Bearer <INTERNAL_OPS_TOKEN>`), entirely separate from customer
login, compared with a constant-time check. If the token isn't configured on the server, these
routes fail closed (503), never silently open.

**`POST /v1/internal/uptime-checks`** — Record a synthetic check result. Response (201):
`{status: "recorded"}`.

**`POST /v1/internal/incidents`** — Create a status-page incident. Response (201):
`{incident}`.

**`PATCH /v1/internal/incidents/:incidentId`** — Update/resolve an incident.
Response (200): `{incident}`.

Errors: `401 invalid_internal_ops_token`, `503 internal_ops_disabled`.

---

## Where to go next

- `docs/HOW_IT_WORKS.md` — the plain-English tour of the whole product
- `docs/embed-contract.md` — the exact public contract for the embeddable widget
- `docs/ARCHITECTURE.md` — session state machine, failure modes, scaling notes
- `.claude/rules/tenancy.md` — the multi-tenancy/RLS rules every route above is built on
