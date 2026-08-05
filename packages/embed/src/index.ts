/**
 * Embed loader — zero runtime dependencies, 10KB gzipped budget enforced by
 * `pnpm --filter @avatrain/embed run size`. See .claude/rules/embed.md.
 */
export function init(): void {
  // Phase 4 fills this in: Shadow DOM host, sandboxed iframe, postMessage
  // bridge. Phase 0 just needs a real, buildable, zero-dep entry point.
}

declare global {
  interface Window {
    Avatrain?: { init: typeof init };
  }
}

if (typeof window !== "undefined") {
  window.Avatrain = { init };
}
