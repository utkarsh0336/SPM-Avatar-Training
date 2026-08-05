/**
 * Single source of truth for OpenAI Realtime API event names — never type a
 * literal event string inline. See .claude/rules/realtime.md.
 *
 * Left empty deliberately: entries land one at a time in Phase 1, verified
 * against the live OpenAI Realtime API docs. Never invent event names.
 */
export const REALTIME_EVENTS = {} as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];
