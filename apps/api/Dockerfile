# syntax=docker/dockerfile:1
#
# Monorepo image — build context is the REPO ROOT, not this directory:
#   docker build -f apps/api/Dockerfile -t avatrain-api .
#
# Uses `pnpm deploy` (not manual node_modules pruning) to produce a
# self-contained, production-only copy of this app plus its workspace
# dependencies (@avatrain/shared) with `workspace:*` protocol deps resolved
# to real files — see https://pnpm.io/cli/deploy. Avoids hand-rolled
# multi-package COPY/prune logic that silently drifts as workspace
# packages are added.

FROM node:20-bookworm-slim AS builder
WORKDIR /repo
RUN corepack enable
# python3/make/g++: several transitive deps (e.g. msgpackr-extract, pulled
# in via @livekit/agents) node-gyp-compile a native addon during install and
# silently fall back to a slower pure-JS path without a toolchain present —
# better to build the real thing than degrade unnoticed. openssl: Prisma's
# query engine needs to detect the OpenSSL major version at `generate` time
# (which runs during install via this repo's root postinstall script) to
# pick the right engine binary target — without it, Prisma warns and
# guesses, which can select a query engine that doesn't load at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Full workspace source — see .dockerignore for what's excluded
# (node_modules, dist, .turbo, etc.). Turborepo's own remote/local build
# cache is what keeps `turbo run build` fast on rebuilds, not fine-grained
# Docker layer splitting here.
COPY . .

RUN pnpm install --frozen-lockfile

# Builds @avatrain/api and every workspace package it depends on
# (turbo.json's build task has dependsOn: ["^build"], so @avatrain/shared
# builds first automatically).
RUN pnpm turbo run build --filter=@avatrain/api...

RUN pnpm --filter=@avatrain/api deploy --prod /app

# `pnpm deploy` only copies @avatrain/api's own declared dependency graph —
# it doesn't re-run the ROOT package.json's `postinstall` (`prisma generate`),
# since that script belongs to the workspace root, not to @avatrain/api's own
# manifest. Without this, /app/node_modules/.prisma/client only contains
# @prisma/client's unbuilt placeholder stub (the file it ships before
# `generate` ever runs), and the app crashes on boot with "@prisma/client did
# not initialize yet" — caught by actually booting this image, not assumed.
# Regenerating against /app's own copied prisma/ + node_modules (not
# /repo's) is what makes the real client the client
# packages/shared/src/db/client.ts actually loads at runtime.
#
# `prisma generate` resolves @prisma/client via plain Node module resolution
# rooted at the --schema file's OWN directory (walking upward through real,
# symlink-resolved ancestors) — not via cwd, and not via any package.json's
# declared dependency list. /app/prisma (this app's own directory) never
# finds it that way, because @avatrain/api's package.json doesn't declare
# @prisma/client directly (only @avatrain/shared does, transitively).
# Placing the schema instead inside @avatrain/shared's own pnpm-store
# directory means the very first ancestor Node checks
# (.pnpm/@avatrain+shared@.../node_modules/@prisma/client, a real pnpm
# symlink for @avatrain/shared's own declared dependency) resolves — and
# because @prisma/client's generated `.prisma/client` output is itself
# addressed the same way (relative to @prisma/client's own real location,
# which that symlink points at), this also happens to be exactly where
# packages/shared/src/db/client.ts's runtime `import { PrismaClient } from
# "@prisma/client"` will find it. Verified against this image's actual
# node_modules layout, not assumed.
RUN SHARED_DIR="$(readlink -f /app/node_modules/@avatrain/shared)" \
    && mkdir -p "$SHARED_DIR/prisma" \
    && cp prisma/schema.prisma "$SHARED_DIR/prisma/schema.prisma" \
    && PRISMA_GENERATE_SKIP_AUTOINSTALL=true /repo/node_modules/.bin/prisma generate --schema "$SHARED_DIR/prisma/schema.prisma"

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Prisma's query engine binary needs libssl at runtime, not just at
# `generate` time — see the builder stage's comment.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app ./

EXPOSE 4000
CMD ["node", "dist/index.js"]
