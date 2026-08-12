const DEFAULT_MAX_CHUNK_CHARS = 1800;
const DEFAULT_OVERLAP_CHARS = 200;
// No tokenizer dependency approved for this phase (see
// .claude/specs/knowledge-management.md's Dependencies section) — ~4
// chars/token is the standard rough estimate for English text. Good enough
// for KnowledgeChunk.tokenCount's informational/UI purpose; never used for
// a billing or hard-limit decision.
const CHARS_PER_TOKEN_ESTIMATE = 4;

export interface ChunkTextOptions {
  maxChunkChars?: number;
  overlapChars?: number;
}

export interface TextChunk {
  content: string;
  index: number;
  estimatedTokenCount: number;
}

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE));
}

/**
 * Word-based sliding-window splitter with overlap — same "hand-roll a small
 * chunker rather than pull in a library" precedent as
 * ../tutor/sentence-chunker.ts, just for ingestion instead of TTS. Packs
 * whitespace-delimited words into windows up to maxChunkChars, then steps
 * the next window back by roughly overlapChars so context that falls right
 * on a boundary isn't lost to retrieval. Deliberately word- rather than
 * paragraph-based: it behaves the same whether the source document has
 * clean paragraph breaks or not (PDF text extraction often doesn't).
 */
export function chunkText(text: string, options: ChunkTextOptions = {}): TextChunk[] {
  const maxChunkChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [];

  const contents: string[] = [];
  let start = 0;

  while (start < words.length) {
    let end = start;
    let length = 0;
    while (end < words.length && length + words[end]!.length + 1 <= maxChunkChars) {
      length += words[end]!.length + 1;
      end++;
    }
    // Always make forward progress, even if a single word alone exceeds
    // maxChunkChars (e.g. a long URL or identifier with no spaces).
    if (end === start) end = start + 1;

    contents.push(words.slice(start, end).join(" "));

    if (end >= words.length) break;

    // Step the next window back by ~overlapChars worth of trailing words.
    // Bounded by `i > start`, so overlapWords < (end - start) always —
    // guarantees at least 1 word of forward progress per iteration.
    let overlapWords = 0;
    let overlapLength = 0;
    let i = end - 1;
    while (i > start && overlapLength < overlapChars) {
      overlapLength += words[i]!.length + 1;
      overlapWords++;
      i--;
    }
    start = end - overlapWords;
  }

  return contents.map((content, index) => ({
    content,
    index,
    estimatedTokenCount: estimateTokenCount(content),
  }));
}
