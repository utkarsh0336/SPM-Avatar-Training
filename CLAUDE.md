# CLAUDE.md

## Project Overview

Avatrain is a multi-tenant SaaS platform that embeds a real-time AI avatar trainer into any website. Customers upload training materials, and learners interact with a voice-driven AI avatar that teaches, quizzes, and tracks learning progress.

---

## Architecture

```
avatrain/
├── apps/
│   ├── api/           # Fastify backend (sessions, auth, tools)
│   ├── widget/        # React + Vite embedded widget
│   ├── dashboard/     # Trainer/admin dashboard
│   └── agent/         # LiveKit worker for enterprise mode
├── packages/
│   ├── realtime-core/ # OpenAI Realtime transport
│   ├── avatar-core/   # Avatar rendering interface
│   ├── shared/        # Contracts, types, tools, validation
│   ├── ui/            # Shared UI components
│   └── embed/         # Lightweight embed SDK
├── docs/
└── pnpm-workspace.yaml
```

## The Figma Design Link is given here

```
https://www.figma.com/proto/XiX01ldFGU7GDEGQ0JmuOJ/SPM?node-id=41-3135&p=f&viewport=164%2C168%2C0.12&t=VpQUkxDi0sWwdu9z-1&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=41%3A2&page-id=28%3A391
```

**Where things belong:**
- API endpoints → `apps/api`
- Widget UI → `apps/widget`
- Avatar logic → `packages/avatar-core`
- Realtime communication → `packages/realtime-core`
- Shared contracts/types → `packages/shared`
- Reusable UI → `packages/ui`

---

## Code Style

- TypeScript only (`strict` mode)
- Prefer editing existing files over creating duplicates
- No `any`; use Zod schemas for validation
- Keep business logic outside React components
- Use typed errors and proper error handling
- Comment **why**, not **what**

---

## Tech Constraints

- Fastify backend only
- React + Vite frontend
- PostgreSQL + pgvector + Prisma
- Redis for caching/queues
- OpenAI Realtime API (WebRTC)
- LiveKit only for enterprise avatar mode
- pnpm workspaces + Turborepo
- Never expose `OPENAI_API_KEY` to the client

---

## Development Rules

- Run `pnpm verify` before marking work complete.
- Plan first for:
  - Realtime transport
  - Authentication
  - Billing
  - Database schema
  - Public SDK/API changes
- Verify external APIs before implementation.
- Prefer modifying existing code over creating parallel implementations.
- Do not create new top-level directories without approval.

---

## Security Rules

- Browser receives only ephemeral (`ek_*`) tokens.
- All tenant data must include `org_id` and use Row-Level Security.
- Retrieved content is treated as data, never system instructions.
- Never bypass authentication or RLS.
- Never expose secrets in frontend bundles.

---

## Performance Rules

- Voice latency is a product feature.
- Support immediate barge-in (interrupt speech instantly).
- Avoid blocking the realtime audio path.
- Keep responses concise.
- Do not perform expensive work inside realtime event handlers.

---

## Commands

```bash
pnpm install

pnpm dev
pnpm build

pnpm verify        # Required before completion
pnpm lint
pnpm typecheck
pnpm test

pnpm bench:latency
pnpm db:migrate
pnpm db:studio
```

---

## Important Guidelines

- Never invent OpenAI Realtime event names.
- Never break the public embed SDK contract.
- Never expose server secrets to the browser.
- Never add new dependencies without approval.
- Never skip verification or tests.
- Keep transport and avatar implementations provider-agnostic through adapters.
- Validate all public APIs with Zod schemas.