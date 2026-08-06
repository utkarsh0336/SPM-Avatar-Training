#!/usr/bin/env node
// Enforces .claude/rules/tenancy.md: every tenant-scoped table needs an
// org_id column and an RLS policy. Static analysis over the committed
// migration SQL — no live database required.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "prisma/migrations";
// "users" is a global identity root, not tenant-scoped — same reasoning as
// "organizations" above. See prisma/schema.prisma's User model doc-comment.
const EXEMPT_TABLES = new Set(["organizations", "users"]);

function findSqlFiles(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      out = out.concat(findSqlFiles(full));
    } else if (entry.endsWith(".sql")) {
      out.push(full);
    }
  }
  return out;
}

function extractCreateTables(sql) {
  const tables = [];
  const regex = /CREATE TABLE\s+"([^"]+)"\s*\(/gi;
  let match;
  while ((match = regex.exec(sql))) {
    const name = match[1];
    let depth = 0;
    let i = sql.indexOf("(", match.index);
    const bodyStart = i;
    for (; i < sql.length; i++) {
      if (sql[i] === "(") depth++;
      if (sql[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    tables.push({ name, body: sql.slice(bodyStart, i + 1) });
  }
  return tables;
}

const files = findSqlFiles(MIGRATIONS_DIR);

if (files.length === 0) {
  console.log("verify:rls — no migrations yet, nothing to check.");
  process.exit(0);
}

const fullSql = files.map((f) => readFileSync(f, "utf8")).join("\n");
const tables = files.flatMap((f) => extractCreateTables(readFileSync(f, "utf8")));

let failed = false;

for (const table of tables) {
  if (EXEMPT_TABLES.has(table.name)) continue;

  const problems = [];

  if (!/\borg_id\b/i.test(table.body)) {
    problems.push('missing "org_id" column');
  }

  const rlsEnabled = new RegExp(
    `ALTER TABLE\\s+"${table.name}"\\s+ENABLE ROW LEVEL SECURITY`,
    "i",
  ).test(fullSql);
  if (!rlsEnabled) {
    problems.push("missing ENABLE ROW LEVEL SECURITY");
  }

  const hasPolicy = new RegExp(`CREATE POLICY[\\s\\S]*?ON\\s+"${table.name}"`, "i").test(fullSql);
  if (!hasPolicy) {
    problems.push("missing a CREATE POLICY");
  }

  if (problems.length > 0) {
    failed = true;
    console.error(`✘ "${table.name}": ${problems.join(", ")}`);
  } else {
    console.log(`✓ "${table.name}" has org_id + RLS policy`);
  }
}

if (failed) {
  console.error(
    "\nverify:rls failed — every tenant table needs org_id and an RLS policy. See .claude/rules/tenancy.md.",
  );
  process.exit(1);
}

console.log("verify:rls passed.");
