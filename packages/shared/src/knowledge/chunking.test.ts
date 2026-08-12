import { describe, expect, it } from "vitest";
import { chunkText } from "./chunking.js";

describe("chunkText", () => {
  it("returns an empty array for empty/whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\t  ")).toEqual([]);
  });

  it("returns a single chunk for text under the max size", () => {
    const chunks = chunkText("The quick brown fox jumps over the lazy dog.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe("The quick brown fox jumps over the lazy dog.");
    expect(chunks[0]!.index).toBe(0);
  });

  it("splits long text into multiple chunks bounded by maxChunkChars", () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
    const text = words.join(" ");
    const chunks = chunkText(text, { maxChunkChars: 100, overlapChars: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(100);
    }
  });

  it("assigns sequential zero-based indices", () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`);
    const chunks = chunkText(words.join(" "), { maxChunkChars: 50, overlapChars: 10 });
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("carries overlap from the end of one chunk into the start of the next", () => {
    const words = Array.from({ length: 20 }, (_, i) => `w${i}`);
    const chunks = chunkText(words.join(" "), { maxChunkChars: 40, overlapChars: 15 });

    expect(chunks.length).toBeGreaterThan(1);
    const firstWords = chunks[0]!.content.split(" ");
    const secondWords = chunks[1]!.content.split(" ");
    // The last word of chunk 0 should reappear near the start of chunk 1.
    expect(secondWords).toContain(firstWords[firstWords.length - 1]);
  });

  it("makes forward progress even when a single word exceeds maxChunkChars", () => {
    const longWord = "x".repeat(500);
    const text = `${longWord} short words here`;
    const chunks = chunkText(text, { maxChunkChars: 50, overlapChars: 10 });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.content).toBe(longWord);
  });

  it("terminates (no infinite loop) on pathological input", () => {
    const text = Array.from({ length: 1000 }, () => "a".repeat(30)).join(" ");
    const chunks = chunkText(text, { maxChunkChars: 25, overlapChars: 24 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(2000);
  });

  it("estimates a positive token count roughly proportional to content length", () => {
    const chunks = chunkText("word ".repeat(100).trim());
    expect(chunks[0]!.estimatedTokenCount).toBeGreaterThan(0);
    expect(chunks[0]!.estimatedTokenCount).toBeCloseTo(chunks[0]!.content.length / 4, -1);
  });
});
