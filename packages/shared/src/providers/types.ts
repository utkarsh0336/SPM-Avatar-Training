/**
 * The four swappable provider interfaces from .claude/specs/ai-avatar.md §4.
 * The app codes against these only — no provider SDK type may leak above
 * this boundary (enforced by scripts/verify-provider-boundary.mjs).
 *
 * STTProvider.transcribe returns a single Promise<string>, not an
 * AsyncIterator<partial|final> — Groq Whisper is a batch-per-utterance API,
 * and faking incremental partials on top of it would not be a real feature.
 * AvatarProvider is intentionally not declared here — it is client-side
 * only (no secrets) and lives in packages/avatar-core instead.
 */

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMChatOptions {
  systemPrompt: string;
  signal: AbortSignal;
}

export interface LLMProvider {
  readonly name: string;
  /** Yields token/text deltas as they stream in. */
  chat(messages: LLMMessage[], opts: LLMChatOptions): AsyncIterable<string>;
}

export interface STTProvider {
  readonly name: string;
  /** One call per VAD-bounded utterance, not per audio chunk. */
  transcribe(audioBytes: Uint8Array, mimeType: string): Promise<string>;
}

export interface TTSSynthesizeOptions {
  signal: AbortSignal;
  /**
   * Redundant confirmation of the gender already encoded in the requested
   * voice name (see resolvePrimaryVoice/resolveVoiceGender in
   * tts-voice-map.ts), not a real selection mechanism — echogarden's
   * voiceGender option only filters its voice catalog by each entry's own
   * declared gender tag; it cannot pick a speaker id inside a multi-speaker
   * model. (A previous version of this comment claimed the opposite; that
   * was wrong — verified directly against the installed echogarden package's
   * source, not a live listening test, which is exactly how it went
   * unnoticed: every avatar was actually resolving to the same untagged
   * multi-speaker model's default speaker regardless of gender.) Providers
   * with a single fixed voice per candidate (msedge-tts) ignore this.
   */
  voiceGender?: "male" | "female";
}

export interface TTSProvider {
  readonly name: string;
  /** Constant per provider — lets callers set the right WS/audio-element mime type without inspecting bytes. */
  readonly mimeType: string;
  /** Yields audio chunks (per-sentence for the primary provider). */
  synthesize(text: string, voice: string, opts: TTSSynthesizeOptions): AsyncIterable<Uint8Array>;
}
