# Avatrain

Multi-tenant SaaS platform embedding a real-time AI avatar trainer into any website. See `CLAUDE.md` for the full architecture/conventions and `.claude/specs/ai-avatar.md` for the AI conversation pipeline's implementation brief.

## Running the AI Avatar Tutor pipeline locally

This section covers the free-tier conversational pipeline behind the dashboard's live training session screen (Gemini/Groq LLM, Groq Whisper STT, self-hosted Piper TTS via `echogarden`, a Mock avatar renderer, over a plain WebSocket). It runs at **$0/month** by design — every provider is a free tier or self-hosted, and no code path spends money unless you explicitly opt in.

### Prerequisites

- Node.js >= 20.19.0, pnpm 9.15.9
- Docker (for the local Postgres/Redis compose stack — see `pnpm dev`)
- A free [Google AI Studio](https://aistudio.google.com/apikey) API key (Gemini)
- A free [Groq Cloud](https://console.groq.com/keys) API key (no credit card)

### Setup

1. `pnpm install`
2. Copy `.env.example` to `.env` and fill in `GEMINI_API_KEY` / `GROQ_API_KEY` (plus whatever auth/DB vars `.env.example` already documents). Every variable this pipeline needs is documented there, with where to get it and its free-tier limit.
3. `pnpm dev` — starts the Docker Postgres/Redis stack and every app in parallel (`apps/api` on :4000, `apps/dashboard` on :3000).

### First run: TTS voice model download

The first time the backend synthesizes speech, `echogarden` (the Piper TTS engine) downloads its voice model (`en_US-libritts_r-medium`, CC BY 4.0) plus an `espeak-ng` phonemizer dependency — about 85MB total, cached to your OS's app-data directory (e.g. `~/Library/Application Support/echogarden` on macOS) so this only happens once. This can take ~30 seconds on a cold start; every synthesis call after that is fast (well under a second). `apps/api` warms this up once at boot rather than on a live user's first turn.

### Trying it out

1. Sign up / log in at `http://localhost:3000`.
2. Complete the Avatar Builder wizard (style, gender, appearance, outfit, name + expertise, voice tone). The final step writes your choices to `localStorage` and returns to the dashboard.
3. Start a training session. Speak — voice activity detection ends your turn automatically (no push-to-talk); the avatar replies with streamed audio, a subtitle bar, and a transcript entry. Interrupt it mid-sentence to test barge-in.

### Provider architecture

Four swappable interfaces (`LLMProvider`, `STTProvider`, `TTSProvider`, `AvatarProvider` — see `packages/shared/src/providers/types.ts` and `packages/avatar-core/src/index.ts`), selected via env var (`LLM_PROVIDER`, `TTS_PROVIDER`) with automatic failover for LLM and TTS. No provider SDK type is used outside its own adapter file — enforced by `scripts/verify-provider-boundary.mjs` and an ESLint rule, both run in `pnpm verify`.

### What's stubbed / not built yet

- **Avatar rendering** is Phase 1 only: a looping idle video clip (`apps/dashboard/public/avatars/idle/`), no lip-sync. You'll need to supply your own clips there — everything degrades gracefully to a gradient placeholder without them. Phase 2 (Tavus/HeyGen) and Phase 3 (self-hosted lip-sync) are explicitly not built.
- **No persisted sessions** — transcripts live in memory for the life of a browser tab/WS connection, matching the existing mock session list's behavior. A page refresh loses the conversation.
- **Dashboard, saved conversations, notifications, and settings** are out of scope for this pipeline pass per the brief.

## Deployment

Production deployment (Fly.io, containerized `apps/api`/`apps/agent`, region-pinned per
`Organization.dataRegion`, custom-metric autoscaling for the agent worker pool) is documented in
`infra/README.md` — see `docs/adr/0006-autoscaling-strategy.md` for why Fly.io over Kubernetes.

## Commands

```bash
pnpm install
pnpm dev              # docker compose up -d + turbo dev, all apps
pnpm build
pnpm verify            # lint + typecheck + test + RLS/provider-boundary/secret checks — required before completion
pnpm lint
pnpm typecheck
pnpm test
pnpm bench:latency
pnpm db:migrate
pnpm db:studio
```
