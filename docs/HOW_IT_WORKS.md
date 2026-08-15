# How Avatrain works (plain-English guide)

This is the "explain it to me simply" version of the project. For the deep technical
reference, see `CLAUDE.md` and `docs/ARCHITECTURE.md` — this doc exists so you don't have to
read those first. For the API reference, see `docs/API.md`.

---

## 1. What Avatrain actually is

Avatrain lets a company drop a small `<script>` tag into their website and get a talking AI
avatar that can **teach a course, answer questions about the company's own documents, quiz the
learner, and track whether they passed** — all by voice, in real time.

Two kinds of people use the product:

- **Trainers / admins** — log into a dashboard, build an avatar (how it looks and sounds),
  upload training material, write a curriculum, and see how learners are doing.
- **Learners** — never log into anything. They land on the customer's website, click the
  widget, and start talking to the avatar.

---

## 2. The five pieces, in one sentence each

| Piece | What it is | In plain terms |
|---|---|---|
| `apps/api` | Fastify backend | The brain — every request, every AI call, every database read goes through here. |
| `apps/dashboard` | Next.js web app | The trainer's control panel — build avatars, upload docs, see analytics. |
| `apps/widget` | Small React app | The actual chat/video box that gets embedded on a customer's website. |
| `apps/agent` | LiveKit worker | An optional "premium" mode for Enterprise customers that gives a higher-fidelity video avatar. |
| `packages/*` | Shared libraries | Code shared between the above — see §7. |

Nothing about the avatar's "intelligence" lives in the widget or the dashboard. Both are just
UI shells; **all thinking happens on the server**, so an API key or trade secret never has to
sit in a browser tab.

---

## 3. A learner's journey, step by step

This is what happens when someone lands on a customer's website and talks to the avatar
(the normal, free-tier path — "Mode A").

```
1. Customer's page loads    → <script src=".../embed.js"> runs (a ~10KB loader, nothing else)
2. Loader mounts an iframe  → the iframe loads apps/widget, isolated from the host page's CSS/JS
3. Widget asks the API      → "who am I, and which avatar am I allowed to show?"
                               (GET /v1/embed/config?key=pk_xxx — the publishable key
                               identifies the customer, never a secret)
4. API mints a short-lived
   connection ticket        → POST /v1/embed/ticket — single-use, expires in 60 seconds
5. Widget opens a
   connection to the API    → mic access requested, voice activity detection starts listening
6. Learner speaks           → audio streams to the server; the server transcribes it (STT)
7. Server asks the LLM      → the model's answer streams back token-by-token
8. Server speaks the reply  → text-to-speech starts on the *first sentence*, not the whole
                               answer — this is why the avatar starts talking in well under
                               two seconds instead of waiting for the full response
9. Avatar video + subtitles → play in sync with the audio; a transcript line appears too
10. Learner can interrupt   → "barge-in": speaking while the avatar talks instantly cancels
                               its current sentence and starts listening again
```

If the learner is mid-lesson, the AI isn't just chatting — it's working through a curriculum
(see §5) and can quiz them, grade the answer, and remember whether they passed.

**Anonymous by default.** A widget visitor on a customer's site isn't logged into Avatrain.
They get real-time feedback ("nice, that's correct!") but nothing is saved to their permanent
record — there's no "their record" to save to. If a company wants tracked, gradable training
for a specific person, that person needs a real Avatrain-side identity (this is the dashboard's
"rehearsal" mode, used today for testing curricula before publishing them).

---

## 4. A trainer's journey, step by step

This is what happens on the dashboard side, before any learner ever sees the avatar.

1. **Sign up / log in** — email+password or Google login. Each account belongs to one
   organization (a company's tenant).
2. **Onboarding wizard** — a 6-step avatar builder: pick a visual style (realistic / animated /
   3D), gender, appearance (skin tone, hair), outfit, then name + area of expertise, then a
   voice tone. There's a live preview the whole way through.
3. **Upload knowledge** — PDFs, Word docs, slide decks, even video, get uploaded, parsed into
   chunks, and turned into embeddings (a numeric fingerprint of meaning) so the AI can look
   things up instead of guessing. This is what makes the avatar's answers *grounded* in the
   company's actual material instead of hallucinated.
4. **Build a curriculum** — a trainer writes (or the AI helps draft) a sequence of teaching
   objectives, each with what to teach, a check question, and grading criteria. Optionally,
   branching scenario questions ("if the learner says X, go here; if Y, go there") and a simple
   self-checkoff induction checklist.
5. **Test it themselves** — the dashboard has a "rehearsal" session screen so a trainer can talk
   to their own avatar exactly like a learner would, before publishing it anywhere.
6. **Publish via embed** — under Settings → Embed, the trainer creates an "Application": a
   name, a list of allowed website origins, and which avatar it points to. This generates a
   publishable key and the `<script>` snippet to paste into their site.
7. **Watch analytics** — completion rates, where learners drop off, how accurate/grounded the
   AI's answers were, and learner satisfaction ratings (1–5 stars), all broken out by whether
   the data is real organization-wide activity or just the trainer's own rehearsal sessions
   (rehearsal traffic is clearly labeled, never silently mixed into "real" numbers).

---

## 5. How the AI actually "teaches" instead of just chatting

The AI doesn't get to freely decide it taught something or graded someone correctly — that
would let a model hallucinate progress. Instead, the server hands the model a small toolbox and
only *the server* decides what those tools actually do:

| Tool | What it does |
|---|---|
| `search_knowledge` | Look up relevant chunks from the company's uploaded documents before answering, so the reply is grounded in real material, not invented. |
| `show_asset` | Reference a specific document/image the avatar is talking about. |
| `start_checkpoint` | Begin a check-question moment for the current teaching objective. |
| `grade_answer` | The server (not the model) judges whether the learner's spoken answer meets the objective's grading criteria. |
| `record_progress` | Permanently save a pass/retry verdict for this learner + objective — only ever called with a verdict the server itself just computed, never one the model claims. |
| `end_module` | Wrap up, but only allowed if there's real recorded progress to measure completion against — refused outright for anonymous learners, since there's nothing to measure. |

This "server grades, model narrates" split is why a learner can't sweet-talk the avatar into
marking them as having passed something they didn't.

---

## 6. Two ways the avatar can talk to you

Most customers use **Mode A** — the default, described in §3: the widget talks almost directly
to the AI provider over a real-time connection, kept fast and cheap. Good enough video comes
from a lightweight 3D/mesh renderer running in the browser.

**Mode B** is an Enterprise-only upgrade: `apps/agent` is a background worker that joins a
LiveKit video room and drives a higher-fidelity, photoreal-style avatar provider. It's
deliberately more expensive, so it only starts once a real human has actually joined the room
(never spun up speculatively), and it automatically shuts itself down when the last human
leaves or the session runs too long. If the fancier video provider has a hiccup, the session
degrades to the simpler renderer rather than dropping the learner.

Both modes present an identical UI to the learner — you can't tell which one you're in by
looking at it.

---

## 7. The shared building blocks (`packages/`)

- **`realtime-core`** — the voice/session engine: the state machine that governs "idle →
  connecting → listening → speaking → thinking," barge-in handling, voice activity detection,
  and audio format conversion. Written provider-agnostically, so swapping the underlying
  real-time API doesn't mean a rewrite.
- **`avatar-core`** — everything about rendering the avatar itself: idle animations, lip-sync
  drivers, gesture/expression systems, and the "avatar provider" interface that both Mode A's
  mesh renderer and Mode B's photoreal provider implement identically.
- **`shared`** — Zod schemas (the source of truth for what a valid request/response looks
  like), types, the tool definitions from §5, auth helpers, and the redaction logic that scrubs
  PII before anything is saved to the database.
- **`ui`** — shared React components/design system used by the dashboard.
- **`embed`** — the tiny, dependency-free loader script customers actually paste into their
  site (`docs/embed-contract.md` has its exact public contract — treat it like a public API,
  because it is one).

---

## 8. Where your data actually lives

Everything is stored per-organization in Postgres, isolated with row-level security so one
customer's data is structurally invisible to another — not just filtered in application code,
enforced by the database itself. Roughly:

| Group | Tables (plain meaning) |
|---|---|
| **Identity** | `Organization` (a tenant), `User`/`Membership` (who belongs to which org, with role OWNER / MEMBER / PARTNER), `Session` (login sessions), `Application` (one embeddable widget config: allowed websites + which avatar it shows). |
| **The avatar & what it teaches** | `Avatar` (look, voice, personality), `Curriculum` → `Objective` (one teachable/checkable unit) → optional `ScenarioStep`/`ScenarioBranch` (branching dialogue), `InductionChecklist`/`ChecklistItem` (simple self-checkoff tasks). |
| **The knowledge base** | `KnowledgeDocument` (an uploaded file, versioned), `KnowledgeChunk` (a searchable, embedded slice of that file). |
| **What actually happened** | `TrainingSession` (one conversation), `Message` (one turn in it, PII-redacted before it's ever written), `ObjectiveProgress`/`ChecklistItemProgress` (did this learner pass this thing). |
| **How well it's working** | `TurnMetric` (latency per response stage), `KnowledgeAccessEvent` (which documents actually got used), `SatisfactionRating` (1–5 star feedback). |
| **Platform health** (not customer data) | `UptimeCheck`, `StatusIncident` — power the public `/status` page. |

---

## 9. Security, in plain terms

- **The browser never gets a real API key.** It only ever holds a short-lived, single-use
  "ticket" (expires in ~60 seconds) or a publishable key that identifies *which* customer is
  asking, not a credential that can act on their behalf.
- **One customer literally cannot see another's data.** Every tenant-owned database table is
  tagged with an organization id and enforced by Postgres row-level security, not just an
  `if` check in the code.
- **The AI never grades itself.** As covered in §5, pass/fail decisions are computed
  server-side and the model only narrates them.
- **Uploaded/retrieved content is treated as data, not instructions** — a malicious sentence
  hidden in a customer's PDF can't hijack the AI's behavior, because retrieved text is passed
  to the model as content to reference, never as something with system-level authority.
- **Personal information is scrubbed before storage, not after** — structured PII patterns
  (things like emails, phone numbers) are redacted at write-time in `packages/shared/src/redact.ts`.

---

## 10. Running it and deploying it, in plain terms

- **Locally:** `pnpm install`, copy `.env.example` to `.env`, add two free API keys (Gemini +
  Groq), run `pnpm dev`. Everything — Postgres, Redis, every app — starts together. See the
  root `README.md` for the exact walkthrough; it runs at $0/month by design.
- **In production:** deployed to Fly.io as four small services (API and the LiveKit worker,
  each duplicated in a US and an EU region so a company's data physically never leaves its
  chosen region). `apps/api` scales itself based on request load; `apps/agent` scales based on
  how many live sessions are actually running, since it's a background worker, not a web
  server. Full detail: `infra/README.md`.
- **If something breaks:** a public status page (`/status`) reflects real uptime checks and
  incidents, errors are captured centrally (Sentry), and there are step-by-step runbooks for
  the on-call engineer in `docs/runbooks/`.

---

## 11. Want more detail?

This doc intentionally skips the "why," the failure-mode tables, and the exact state machine —
that's all in `docs/ARCHITECTURE.md`. Other useful references:

- `docs/API.md` — full endpoint-by-endpoint API reference
- `docs/embed-contract.md` — the exact public contract the embeddable widget must never break
- `docs/adr/` — architecture decision records (why Fly.io, why Postgres+pgvector, etc.)
- `docs/runbooks/` — what to do during an incident
- `docs/ROADMAP.md` — what's built vs. what's still ahead
- `CLAUDE.md` — the canonical rules for working in this codebase
