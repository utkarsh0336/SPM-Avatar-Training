---
paths:
  - "packages/embed/**"
  - "packages/shared/src/contracts/**"
---

# Embed contract rules

- `packages/embed` has **zero runtime dependencies** and a **10KB gzipped** budget. `pnpm size`
  enforces it. Do not add a dependency here; inline what you need.
- Anything under `contracts/` is consumed by customer code we cannot redeploy. Additive changes
  only. Breaking changes need a new CDN major (`/v1/` → `/v2/`) and a migration note.
- Every `postMessage` is origin-checked against an exact string and schema-validated with zod, in
  both directions. Never `'*'`.
- No global CSS, no `window` pollution beyond `window.Avatrain`.
- Contract changes update `apps/docs` in the same PR and run `contract-guard`.