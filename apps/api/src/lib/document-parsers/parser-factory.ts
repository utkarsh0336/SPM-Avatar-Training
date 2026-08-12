import type { DocumentParser } from "./types.js";
import { pdfParser } from "./pdf.js";
import { docxParser } from "./docx.js";
import { txtParser } from "./txt.js";

// Keyed by mime type from @avatrain/shared's SUPPORTED_KNOWLEDGE_MIME_TYPES
// (single source of truth, checked at upload time by knowledge routes).
// PPTX/XLS/CSV/HTML/URL from the SOW's full format list slot in here later
// without touching call sites — see
// .claude/specs/knowledge-management.md's Files to Create.
const PARSERS: Record<string, DocumentParser> = {
  [pdfParser.mimeType]: pdfParser,
  [docxParser.mimeType]: docxParser,
  [txtParser.mimeType]: txtParser,
};

export function getDocumentParser(mimeType: string): DocumentParser | null {
  return PARSERS[mimeType] ?? null;
}
