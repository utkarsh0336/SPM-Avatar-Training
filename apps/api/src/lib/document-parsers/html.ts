import type { DocumentParser } from "./types.js";

/**
 * Hand-rolled tag stripper, not a full DOM parser — same "hand-roll a small
 * parser" precedent as csv.ts / ../../../../packages/shared/src/knowledge/chunking.ts.
 * Accepted limitation: severely malformed HTML may extract imperfectly.
 * Revisit with a real parser only if this proves insufficient in practice
 * (.claude/specs/knowledge-document-lifecycle.md's Files to Create).
 */
const SCRIPT_OR_STYLE_BLOCKS = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
const SELF_CLOSING_BREAKS = /<(br|hr)\s*\/?>/gi;
const BLOCK_CLOSING_TAGS = /<\/(p|div|section|article|header|footer|main|li|ul|ol|h[1-6]|tr|table)>/gi;
const ANY_TAG = /<[^>]+>/g;
const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};
const HTML_ENTITY_PATTERN = /&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g;

export const htmlParser: DocumentParser = {
  mimeType: "text/html",
  async parse(fileBytes: Buffer): Promise<string> {
    let text = fileBytes.toString("utf-8");
    text = text.replace(SCRIPT_OR_STYLE_BLOCKS, "");
    text = text.replace(SELF_CLOSING_BREAKS, "\n").replace(BLOCK_CLOSING_TAGS, "\n");
    text = text.replace(ANY_TAG, "");
    text = text.replace(HTML_ENTITY_PATTERN, (match) => HTML_ENTITIES[match] ?? match);
    return text
      .replace(/[ \t]+/g, " ")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
  },
};
