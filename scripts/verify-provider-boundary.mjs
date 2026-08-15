#!/usr/bin/env node
// Enforces .claude/specs/ai-avatar.md §4's "No provider SDK types may leak
// above the interface boundary" / DoD's "No provider SDK is imported
// anywhere outside its own adapter file." Static import-statement scan, no
// build required — mirrors scripts/verify-rls.mjs's approach.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SCAN_ROOTS = ["apps", "packages"];
const IGNORE_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", "generated"]);

// package name -> the only file(s) allowed to import it directly. Gemini
// and Groq aren't listed here — both are called via plain fetch (a
// deliberate design choice, see the plan file), so there is no SDK package
// name to restrict for them in the first place.
const RESTRICTED_IMPORTS = {
  echogarden: ["packages/shared/src/providers/tts-echogarden.ts"],
  "msedge-tts": ["packages/shared/src/providers/tts-msedge.ts"],
  "@xenova/transformers": ["packages/shared/src/providers/embedding-local.ts"],
  "pdf-parse": ["apps/api/src/lib/document-parsers/pdf.ts"],
  mammoth: ["apps/api/src/lib/document-parsers/docx.ts"],
  officeparser: ["apps/api/src/lib/document-parsers/pptx.ts"],
  xlsx: ["apps/api/src/lib/document-parsers/xlsx.ts"],
  bullmq: [
    "apps/api/src/lib/ingestion-queue.ts",
    "apps/api/src/lib/ingestion-queue.test.ts",
    "apps/api/src/lib/uptime-retention-job.ts",
    "apps/api/src/lib/uptime-retention-job.test.ts",
  ],
  ioredis: [
    "packages/shared/src/scaling/concurrency-counter.ts",
    "packages/shared/src/scaling/concurrency-counter.test.ts",
    "packages/shared/src/scaling/redis-ping.ts",
  ],
  "livekit-server-sdk": ["apps/api/src/lib/livekit.ts", "apps/api/src/lib/livekit.test.ts"],
  "@sentry/node": ["packages/shared/src/observability/sentry.ts"],
  "simli-client": [
    "apps/api/src/lib/simli.ts",
    "apps/agent/src/simli-bridge.ts",
    "packages/avatar-core/src/simli-avatar-provider.ts",
  ],
};

function findSourceFiles(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      out = out.concat(findSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((root) => findSourceFiles(root));
let failed = false;

for (const [pkg, allowedFiles] of Object.entries(RESTRICTED_IMPORTS)) {
  // Matches `from "pkg"` / `from 'pkg'` and `require("pkg")` — deliberately
  // NOT a bare substring match, so e.g. vi.mock("msedge-tts", ...) in that
  // adapter's own test file doesn't get misclassified as an import.
  const importRegex = new RegExp(`\\bfrom\\s+["']${pkg}["']|\\brequire\\(\\s*["']${pkg}["']\\s*\\)`);
  const allowedSet = new Set(allowedFiles);

  for (const file of files) {
    const relPath = relative(process.cwd(), file).split("\\").join("/");
    if (allowedSet.has(relPath)) continue;
    const source = readFileSync(file, "utf8");
    if (importRegex.test(source)) {
      failed = true;
      console.error(`✘ ${relPath} imports "${pkg}" directly — only ${allowedFiles.join(", ")} may.`);
    }
  }
}

if (failed) {
  console.error(
    "\nverify-provider-boundary failed — provider SDKs may only be imported by their own adapter file. See .claude/specs/ai-avatar.md §4.",
  );
  process.exit(1);
}

console.log("verify-provider-boundary passed — echogarden/msedge-tts are only imported by their designated adapters.");
