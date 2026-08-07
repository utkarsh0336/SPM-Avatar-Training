// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/generated/**",
      "**/next-env.d.ts",
      "venv/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    // Fast-feedback complement to scripts/verify-provider-boundary.mjs
    // (the authoritative check, run in `pnpm verify`) — enforces
    // .claude/specs/ai-avatar.md §4's "No provider SDK types may leak
    // above the interface boundary" at edit time.
    files: ["**/*.ts", "**/*.tsx"],
    ignores: [
      "packages/shared/src/providers/tts-echogarden.ts",
      "packages/shared/src/providers/tts-msedge.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "echogarden",
              message: "Only packages/shared/src/providers/tts-echogarden.ts may import echogarden directly.",
            },
            {
              name: "msedge-tts",
              message: "Only packages/shared/src/providers/tts-msedge.ts may import msedge-tts directly.",
            },
          ],
        },
      ],
    },
  },
);
