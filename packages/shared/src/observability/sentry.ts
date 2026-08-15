import * as Sentry from "@sentry/node";

export interface InitSentryOptions {
  environment?: string;
  release?: string;
}

/**
 * True no-op when dsn is undefined — local dev and CI never need a Sentry
 * account (SENTRY_DSN is optional in both apps/api's and apps/agent's env
 * schema). Called once at process start by apps/api/src/app.ts and
 * apps/agent/src/index.ts, never inside a per-request or per-turn handler
 * (.claude/rules/realtime.md — nothing new on the audio hot path).
 * tracesSampleRate stays 0: this repo only needs error capture, not
 * performance tracing, and tracing has its own request-path overhead.
 */
export function initSentry(dsn: string | undefined, options: InitSentryOptions = {}): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: options.environment,
    release: options.release,
    tracesSampleRate: 0,
  });
}

export { Sentry };
