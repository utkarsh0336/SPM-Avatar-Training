#!/usr/bin/env node
// Enforces .claude/rules/embed.md: packages/embed's built loader must stay
// under a 10KB gzipped budget. Run from packages/embed via `pnpm run size`.
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const BUDGET_BYTES = 10 * 1024;
const DIST_ENTRY = join("dist", "index.js");

if (!existsSync(DIST_ENTRY)) {
  console.error(`check-embed-size: ${DIST_ENTRY} not found — run "pnpm build" first.`);
  process.exit(1);
}

const source = readFileSync(DIST_ENTRY);
const gzipped = gzipSync(source);

console.log(
  `embed bundle: ${source.length}B raw, ${gzipped.length}B gzipped (budget ${BUDGET_BYTES}B)`,
);

if (gzipped.length > BUDGET_BYTES) {
  console.error(
    `check-embed-size: ${gzipped.length}B exceeds the ${BUDGET_BYTES}B gzip budget. See .claude/rules/embed.md.`,
  );
  process.exit(1);
}
