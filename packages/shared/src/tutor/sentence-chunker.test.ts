import { describe, expect, it } from "vitest";
import { SentenceChunker } from "./sentence-chunker.js";

describe("SentenceChunker", () => {
  it("emits a sentence as soon as its boundary arrives in one push", () => {
    const chunker = new SentenceChunker();
    expect(chunker.push("Hello there. ")).toEqual(["Hello there."]);
  });

  it("emits multiple complete sentences from a single push", () => {
    const chunker = new SentenceChunker();
    expect(chunker.push("First one. Second one! Third one? ")).toEqual([
      "First one.",
      "Second one!",
      "Third one?",
    ]);
  });

  it("buffers a sentence split across multiple pushes and emits it once complete", () => {
    const chunker = new SentenceChunker();
    expect(chunker.push("Hello ")).toEqual([]);
    expect(chunker.push("there")).toEqual([]);
    expect(chunker.push(". ")).toEqual(["Hello there."]);
  });

  it("does not split at a period with no trailing whitespace yet (mid-stream, could be a decimal or more text coming)", () => {
    const chunker = new SentenceChunker();
    expect(chunker.push("The value is 3.")).toEqual([]);
    expect(chunker.push("14 exactly. ")).toEqual(["The value is 3.14 exactly."]);
  });

  it("does not split on a period after a known abbreviation", () => {
    const chunker = new SentenceChunker();
    expect(chunker.push("Dr. Smith will see you now. ")).toEqual(["Dr. Smith will see you now."]);
  });

  it("does not split on 'etc.' mid-sentence", () => {
    const chunker = new SentenceChunker();
    expect(chunker.push("Bring pens, paper, etc. to class. ")).toEqual(["Bring pens, paper, etc. to class."]);
  });

  it("force-flushes at the length cap when no sentence boundary ever arrives", () => {
    const chunker = new SentenceChunker();
    const longRun = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const sentences = chunker.push(longRun);
    expect(sentences.length).toBeGreaterThan(0);
    expect(sentences[0]!.length).toBeLessThanOrEqual(400);
  });

  it("flush() returns trailing incomplete text at stream end", () => {
    const chunker = new SentenceChunker();
    chunker.push("Complete one. Trailing partial");
    expect(chunker.flush()).toBe("Trailing partial");
  });

  it("flush() returns null when nothing is buffered", () => {
    const chunker = new SentenceChunker();
    chunker.push("Complete one. ");
    expect(chunker.flush()).toBeNull();
  });

  it("ignores a sentence with no real content (just punctuation)", () => {
    const chunker = new SentenceChunker();
    expect(chunker.push(". ")).toEqual([]);
  });
});
