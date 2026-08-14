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

/**
 * "tool" messages carry a prior tool call's result back to the model —
 * toolCallId ties it to the toolCalls entry that requested it. "assistant"
 * messages set toolCalls only for a turn where the model called a tool
 * instead of (or before) replying in text — see
 * .claude/specs/interactive-assessment.md's Realtime Changes. Both fields
 * are optional so every existing plain-text LLMMessage literal in the
 * codebase keeps compiling unchanged.
 */
export interface LLMMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; args: unknown }[];
}

/**
 * A tool the model may call mid-turn (SOW §3.4/§3.5's
 * start_checkpoint/grade_answer/record_progress/end_module — see
 * packages/shared/src/curriculum/tools.ts). `parameters` is a hand-written
 * JSON Schema object, not derived via a zod-to-json-schema dependency —
 * only four tools exist, not worth the new dependency.
 */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * A provider's chat() yields these instead of raw text once tool-calling is
 * in play — "text" is a token/text delta exactly as before, "tool_call" is
 * one complete model-invoked tool call (arguments always fully assembled
 * before this is yielded, even for providers like Groq/OpenAI that stream
 * a call's arguments in fragments — assembly is the adapter's job).
 */
export type LLMStreamEvent = { type: "text"; text: string } | { type: "tool_call"; id: string; name: string; args: unknown };

export interface LLMChatOptions {
  systemPrompt: string;
  signal: AbortSignal;
  /** Omitted (or empty) means no tool-calling for this call — every event yielded is {type:"text"}. */
  tools?: LLMToolDefinition[];
}

export interface LLMProvider {
  readonly name: string;
  /** Yields text deltas and/or tool-call events as they stream in — see LLMStreamEvent. */
  chat(messages: LLMMessage[], opts: LLMChatOptions): AsyncIterable<LLMStreamEvent>;
}

export interface STTTranscribeOptions {
  /** ISO-639-1 hint (e.g. "hi") — improves accuracy for non-English audio. Omitted lets the provider auto-detect. */
  language?: string;
  /**
   * Domain-vocabulary bias (e.g. the session's curriculum/expertise topic) —
   * passed through verbatim to providers that support it. Omitted (not
   * empty-stringed) when no bias applies. This is accuracy biasing on the
   * SAME single transcription call, not a retry: a confidence-triggered
   * second STT call would be a synchronous await in the speech path with no
   * filler utterance to mask it — see conversation-service.ts's own note
   * that this pipeline has no filler-utterance mechanism, and
   * .claude/agents/latency-auditor.md's rule against exactly that pattern.
   */
  prompt?: string;
}

export interface STTProvider {
  readonly name: string;
  /** One call per VAD-bounded utterance, not per audio chunk. */
  transcribe(audioBytes: Uint8Array, mimeType: string, opts?: STTTranscribeOptions): Promise<string>;
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

/**
 * Fifth provider interface, added by .claude/specs/knowledge-management.md.
 * `dimensions` is load-bearing, not descriptive — it's what
 * `KnowledgeChunk.embedding`'s `vector(384)` column width has to match, so a
 * provider swap either keeps this the same (a pure config change) or forces
 * a migration + full re-embed. Batch-shaped (`texts` in, one vector per
 * text out) rather than one-string-in/one-vector-out — both the ingestion
 * pipeline (many chunks per document) and retrieval (one query at a time,
 * still just a length-1 batch) are naturally expressed as a batch call.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
