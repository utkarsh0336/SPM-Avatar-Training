#!/usr/bin/env node
// Enforces .claude/specs/ai-avatar.md's "No API key may ever reach the
// browser" / DoD's "Grep the production frontend bundle for each API key
// value — zero hits." Builds apps/dashboard, then greps the built output
// for the RAW VALUES of every server-side provider env var — not the
// variable names, which appear harmlessly in code/docs/.env.example.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DASHBOARD_DIR = join("apps", "dashboard");
const BUNDLE_DIR = join(DASHBOARD_DIR, ".next");
// Server-only secrets that must never end up in a browser bundle — every
// key the four providers use. NEXT_PUBLIC_* vars are excluded on purpose:
// those are meant to reach the browser (e.g. NEXT_PUBLIC_API_WS_URL).
// OPENAI_API_KEY added by .claude/specs/knowledge-management.md's
// embedding-openai.ts adapter — a placeholder provider, but it reads this
// var server-side exactly like the other three, so it needs the same check.
const SECRET_ENV_VARS = ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY"];
const MIN_SECRET_LENGTH = 8; // skip trivially short values — nothing meaningful to grep for

console.log(`Building ${DASHBOARD_DIR} — this check needs the real production bundle, not source.`);
try {
  execSync("pnpm --filter @avatrain/dashboard build", { stdio: "inherit" });
} catch {
  console.error("verify-no-secrets-in-bundle: dashboard build failed — fix the build before this check can run.");
  process.exit(1);
}

if (!existsSync(BUNDLE_DIR)) {
  console.error(`verify-no-secrets-in-bundle: ${BUNDLE_DIR} not found after build.`);
  process.exit(1);
}

const secretsToCheck = SECRET_ENV_VARS.map((name) => ({ name, value: process.env[name] })).filter(
  ({ value }) => value && value.length >= MIN_SECRET_LENGTH,
);

if (secretsToCheck.length === 0) {
  console.warn(
    `verify-no-secrets-in-bundle: none of ${SECRET_ENV_VARS.join(", ")} are set in this shell — nothing to check. ` +
      "Run with real .env values loaded (e.g. via the repo's dev env-file) for a meaningful pass.",
  );
  process.exit(0);
}

function findFiles(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) out = out.concat(findFiles(full));
    else out.push(full);
  }
  return out;
}

// .next/cache holds webpack's own build cache (can include stale
// intermediate artifacts unrelated to what actually ships) — only the
// served output matters for this check.
const files = findFiles(BUNDLE_DIR).filter((f) => !f.split(/[\\/]/).includes("cache"));

let failed = false;
for (const { name, value } of secretsToCheck) {
  const hits = files.filter((file) => readFileSync(file, "latin1").includes(value));
  if (hits.length > 0) {
    failed = true;
    console.error(`✘ ${name}'s value was found in the built bundle:\n  ${hits.join("\n  ")}`);
  } else {
    console.log(`✓ ${name}'s value does not appear in the built bundle (${files.length} files checked)`);
  }
}

if (failed) {
  console.error("\nverify-no-secrets-in-bundle failed — a server-only secret reached the browser bundle.");
  process.exit(1);
}
console.log("verify-no-secrets-in-bundle passed.");
