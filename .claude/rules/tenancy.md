---
paths:
  - "apps/api/**"
  - "packages/shared/src/db/**"
  - "prisma/**"
---

# Tenancy rules

- Every tenant-scoped table has `org_id uuid not null` plus an RLS policy on
  `current_setting('app.current_org_id')`. A migration without both fails `pnpm verify:rls`.
- All tenant queries run inside the RLS transaction wrapper (`withOrg(orgId, fn)`). Raw
  `prisma.$queryRaw` outside that wrapper is a defect, not a shortcut.
- New endpoints need a two-org isolation test asserting cross-tenant reads return zero rows.
- `record_progress` and `grade_answer` are `serverOnly`. The server re-checks entitlement rather
  than trusting model arguments.
- Unsigned (anonymous) identity may never write to `ObjectiveProgress`.
- Redact PII before insert, never on read. Rules live in `packages/shared/src/redact.ts`.
- Run `security-reviewer` on any diff touching token minting, auth, or postMessage handling.