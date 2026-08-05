#!/usr/bin/env bash
# PreToolUse hook: hard-block writes that would leak server credentials into client bundles.
# CLAUDE.md rules are context, not enforcement. This is enforcement.
set -euo pipefail

payload="$(cat)"
path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // ""')"
content="$(printf '%s' "$payload" | jq -r '.tool_input.content // .tool_input.new_string // ""')"

# 1. Never write real keys into tracked files.
if printf '%s' "$content" | grep -Eq 'sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{16,}'; then
  echo '{"decision":"block","reason":"Literal API key detected. Use env vars via packages/shared/src/env.ts."}'
  exit 0
fi

# 2. Never expose secrets through a client-visible env prefix.
if printf '%s' "$content" | grep -Eq '(VITE_|NEXT_PUBLIC_)[A-Z_]*(SECRET|API_KEY|TOKEN|PASSWORD)'; then
  echo '{"decision":"block","reason":"Secret behind a public env prefix. VITE_/NEXT_PUBLIC_ vars are shipped to browsers."}'
  exit 0
fi

# 3. The embed loader has a zero-dependency budget.
if [[ "$path" == *"packages/embed/package.json" ]] \
   && printf '%s' "$content" | jq -e '.dependencies | length > 0' >/dev/null 2>&1; then
  echo '{"decision":"block","reason":"packages/embed must stay dependency-free (10KB gz budget)."}'
  exit 0
fi

exit 0