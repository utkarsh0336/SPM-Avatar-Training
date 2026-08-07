export interface BargeInControllerOptions {
  /** Stop local avatar playback immediately — this is what actually delivers the ~300ms budget. */
  stopPlayback: () => void;
  /** Fire-and-forget notification to the server that the in-flight turn was interrupted. */
  notifyServer: (utteranceId: string) => void;
  /** The utteranceId currently being spoken, or null if nothing is playing. */
  getCurrentUtteranceId: () => string | null;
}

export interface BargeInController {
  /** Call from VAD's onSpeechStart. No-ops if nothing is currently playing. */
  handleSpeechStart(): void;
}

/**
 * Barge-in mechanics per .claude/specs/ai-avatar.md §7 — "cancel the
 * in-flight TTS and LLM stream immediately... treat as a core feature, not
 * polish." Fixed order: stop local playback synchronously first (server-
 * side abort of CPU-bound TTS inference is best-effort only — see the plan
 * file's risk note — so the ~300ms budget is a client-side-only guarantee),
 * then notify the server. VAD's own onSpeechStart path is responsible for
 * starting the new recording; no separate step needed here.
 */
export function createBargeInController(options: BargeInControllerOptions): BargeInController {
  return {
    handleSpeechStart(): void {
      const utteranceId = options.getCurrentUtteranceId();
      if (!utteranceId) return;
      options.stopPlayback();
      options.notifyServer(utteranceId);
    },
  };
}
