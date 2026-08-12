/**
 * Adapter boundary for extracting raw text from an uploaded document —
 * same shape as the LLM/STT/TTS/Embedding provider interfaces in
 * @avatrain/shared: one file per parser SDK, enforced by
 * scripts/verify-provider-boundary.mjs.
 */
export interface DocumentParser {
  readonly mimeType: string;
  parse(fileBytes: Buffer): Promise<string>;
}
