// Common abbreviations whose trailing "." must not be treated as a sentence
// boundary. Lowercased, no trailing period (compared against the word right
// before the punctuation).
const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "vs",
  "etc",
  "eg",
  "ie",
  "inc",
  "ltd",
  "no",
  "approx",
  "fig",
  "vol",
  "gen",
  "rev",
  "capt",
  "col",
]);

const MIN_SENTENCE_LENGTH = 2;
const MAX_BUFFER_LENGTH = 400;

function lastWord(text: string): string {
  const match = /([a-zA-Z]+)$/.exec(text);
  return match ? match[1]!.toLowerCase() : "";
}

/**
 * Groups streamed LLM token deltas into complete sentences so TTS can start
 * on the first sentence boundary rather than waiting for the full reply
 * (brief §7). Deliberately requires trailing whitespace already present in
 * the buffer before treating `.`/`!`/`?` as a boundary — this both avoids
 * splitting decimals like "3.14" (no space follows the first `.`) and
 * naturally defers the decision until enough of the stream has arrived to
 * disambiguate an abbreviation from a real sentence end.
 */
export class SentenceChunker {
  private buffer = "";

  /** Feed a streamed text delta; returns any sentences completed by it, in arrival order. */
  push(delta: string): string[] {
    this.buffer += delta;
    const sentences: string[] = [];

    let boundary = this.findBoundary();
    while (boundary !== -1) {
      const sentence = this.buffer.slice(0, boundary).trim();
      this.buffer = this.buffer.slice(boundary);
      if (sentence.length >= MIN_SENTENCE_LENGTH) sentences.push(sentence);
      boundary = this.findBoundary();
    }

    // Safety valve: pathologically unpunctuated output should not buffer
    // forever and delay TTS indefinitely — force a flush at a length cap.
    if (this.buffer.length > MAX_BUFFER_LENGTH) {
      const forced = this.forceFlush();
      if (forced) sentences.push(forced);
    }

    return sentences;
  }

  /** Call once the upstream text stream has ended — returns any trailing partial sentence. */
  flush(): string | null {
    const trailing = this.buffer.trim();
    this.buffer = "";
    return trailing.length > 0 ? trailing : null;
  }

  private forceFlush(): string | null {
    const lastSpace = this.buffer.lastIndexOf(" ", MAX_BUFFER_LENGTH);
    const splitAt = lastSpace > MIN_SENTENCE_LENGTH ? lastSpace : MAX_BUFFER_LENGTH;
    const sentence = this.buffer.slice(0, splitAt).trim();
    this.buffer = this.buffer.slice(splitAt);
    return sentence.length >= MIN_SENTENCE_LENGTH ? sentence : null;
  }

  private findBoundary(): number {
    const re = /[.!?]+\s+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(this.buffer))) {
      const textBeforePunctuation = this.buffer.slice(0, match.index);
      if (ABBREVIATIONS.has(lastWord(textBeforePunctuation))) continue;
      return match.index + match[0].length;
    }
    return -1;
  }
}
