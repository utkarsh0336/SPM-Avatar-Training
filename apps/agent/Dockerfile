# syntax=docker/dockerfile:1
#
# Monorepo image — build context is the REPO ROOT, not this directory:
#   docker build -f apps/agent/Dockerfile -t avatrain-agent .
#
# See apps/api/Dockerfile's header comment for why `pnpm deploy` is used
# instead of hand-rolled node_modules pruning.

FROM node:20-bookworm-slim AS builder
WORKDIR /repo
RUN corepack enable
# See apps/api/Dockerfile's builder-stage comment for why python3/make/g++
# (native addon builds, e.g. msgpackr-extract via @livekit/agents) and
# openssl (Prisma query-engine target detection) are needed here too.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm turbo run build --filter=@avatrain/agent...

RUN pnpm --filter=@avatrain/agent deploy --prod /app

# apps/agent doesn't touch Postgres itself, but it imports @avatrain/shared's
# root barrel (LIVEKIT_AGENT_NAME, createRedisConcurrencyCounter), which
# transitively re-exports db/client.ts — a module that constructs a
# PrismaClient at import time regardless of which named export the caller
# actually uses. Same real bug apps/api/Dockerfile hit and fixed: `pnpm
# deploy` doesn't carry over the generated Prisma client, and re-generating
# it needs to land exactly where @avatrain/shared's own Node resolution will
# find it — see that file's comment for why this specific placement (not
# /app, not cwd tricks) is what actually works.
RUN SHARED_DIR="$(readlink -f /app/node_modules/@avatrain/shared)" \
    && mkdir -p "$SHARED_DIR/prisma" \
    && cp prisma/schema.prisma "$SHARED_DIR/prisma/schema.prisma" \
    && PRISMA_GENERATE_SKIP_AUTOINSTALL=true /repo/node_modules/.bin/prisma generate --schema "$SHARED_DIR/prisma/schema.prisma"

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app ./

# No inbound HTTP port — this worker connects outbound to LiveKit
# (config.LIVEKIT_URL) and registers for job dispatch; nothing listens here.
# `start` is @livekit/agents' CLI production subcommand (as opposed to
# `dev`'s hot-reload/dev-only registration — see apps/agent's package.json
# "dev" script for the dev-mode equivalent).
CMD ["node", "dist/index.js", "start"]
