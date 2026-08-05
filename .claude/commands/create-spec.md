---
description: Create a feature specification and Git branch for the next SPM Avatar Training feature
argument-hint: "Feature name e.g. Authentication, Avatar Renderer, Knowledge Ingestion"
allowed-tools: Read, Write, Glob, Bash(git:*), TodoWrite
---

You are a senior software engineer working on **SPM Avatar Training**, a multi-tenant AI Avatar Training SaaS.

Always follow the project rules defined in `CLAUDE.md`.

User input: $ARGUMENTS

# Step 1 — Ensure the repository is clean

Run:

```bash
git status
```

If there are any modified, staged, or untracked files, stop immediately.

Tell the user:

> Please commit or stash your current changes before creating a new feature branch.

Do not continue until the working tree is clean.

---

# Step 2 — Parse the arguments

Extract from `$ARGUMENTS`:

## feature_title

Human-readable title in Title Case.

Examples:
- Authentication
- Avatar Training Session
- Knowledge Ingestion
- Dashboard Analytics
- User Management
- Avatar Renderer

## feature_slug

Lowercase kebab-case.

Rules:

- only a-z
- numbers
- hyphen
- maximum 40 characters

Examples:

```
authentication
avatar-training-session
knowledge-ingestion
dashboard-analytics
```

## branch_name

Format:

```
feature/<feature_slug>
```

Example:

```
feature/avatar-training-session
```

If you cannot infer these values, ask the user before continuing.

---

# Step 3 — Ensure the branch does not already exist

Run:

```bash
git branch
```

If the branch exists, append:

```
-01
-02
-03
```

until a unique branch name is found.

Example:

```
feature/avatar-training-session-01
```

---

# Step 4 — Update main

Run:

```bash
git checkout main
git pull origin main
```

---

# Step 5 — Create the feature branch

Run:

```bash
git checkout -b <branch_name>
```

---

# Step 6 — Research the project

Before writing the specification, read:

- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `apps/api`
- `apps/widget`
- `apps/dashboard`
- `apps/agent`
- `packages/avatar-core`
- `packages/realtime-core`
- `packages/shared`
- Every specification inside `.claude/specs/`

Avoid creating duplicate specifications.

If the requested feature already exists or is marked complete in the roadmap or an existing specification, stop and inform the user.

---

# Step 7 — Create the specification

Generate the specification using the following format.

# Spec: <feature_title>

## Overview

Describe what this feature does and how it fits into the SPM Avatar Training platform.

---

## Business Goal

Explain the business value and user problem this feature solves.

---

## Depends On

List prerequisite features.

If none:

```
None
```

---

## Components Affected

List every application/package affected.

Example:

- apps/api
- apps/widget
- apps/dashboard
- apps/agent
- packages/avatar-core
- packages/realtime-core
- packages/shared

---

## API Changes

List all new or modified endpoints.

If none:

```
No API changes.
```

---

## Database Changes

Describe:

- Prisma schema changes
- Tables
- Columns
- Indexes
- Migrations

If none:

```
No database changes.
```

---

## UI Changes

Describe changes for:

- Widget
- Dashboard
- Avatar
- Analytics
- Admin

If none:

```
No UI changes.
```

---

## Realtime Changes

Describe any updates involving:

- OpenAI Realtime API
- WebRTC
- LiveKit
- Audio pipeline
- Avatar rendering
- Session lifecycle

If none:

```
No realtime changes.
```

---

## Files to Modify

List every existing file expected to change.

---

## Files to Create

List every new file expected to be created.

---

## Dependencies

List new npm packages if required.

Otherwise:

```
No new dependencies.
```

---

## Implementation Rules

Always follow:

- Follow every rule in `CLAUDE.md`
- Never expose `OPENAI_API_KEY`
- Maintain tenant isolation using `org_id`
- Keep provider-specific logic inside adapters
- Validate APIs with Zod
- Preserve the public embed SDK contract
- Keep realtime latency low
- Use strict TypeScript
- Never use `any`
- Prefer modifying existing code
- Run `pnpm verify`
- Update documentation when public APIs change

---

## Testing

Include:

- Unit Tests
- Integration Tests
- End-to-End Tests
- Realtime Tests
- Latency Benchmarks
- Manual Verification

---

## Definition of Done

Checklist:

- Feature works end-to-end
- All tests pass
- `pnpm verify` passes
- No lint errors
- No TypeScript errors
- Documentation updated
- Latency budget maintained
- No security regressions

---

# Step 8 — Save the specification

Save as:

```
.claude/specs/<feature_slug>.md
```

---

# Step 9 — Report

Print exactly:

```
Branch:    <branch_name>
Spec file: .claude/specs/<feature_slug>.md
Title:     <feature_title>
```

Then print:

```
Review the specification before implementation.

Enter Plan Mode (Shift+Tab twice) and review the architecture before writing code.
```

Do not print the complete specification unless explicitly requested.