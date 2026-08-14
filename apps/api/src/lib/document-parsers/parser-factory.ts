import type { DocumentParser } from "./types.js";
import { pdfParser } from "./pdf.js";
import { docxParser } from "./docx.js";
import { txtParser } from "./txt.js";
import { pptxParser } from "./pptx.js";
import { xlsxParser } from "./xlsx.js";
import { csvParser } from "./csv.js";
import { htmlParser } from "./html.js";

// Keyed by mime type from @avatrain/shared's SUPPORTED_KNOWLEDGE_MIME_TYPES
// (single source of truth, checked at upload time by knowledge routes).
// Legacy binary Office formats (.ppt, .xls) and URL ingestion remain
// deferred — see .claude/specs/knowledge-document-lifecycle.md's Overview.
const PARSERS: Record<string, DocumentParser> = {
  [pdfParser.mimeType]: pdfParser,
  [docxParser.mimeType]: docxParser,
  [txtParser.mimeType]: txtParser,
  [pptxParser.mimeType]: pptxParser,
  [xlsxParser.mimeType]: xlsxParser,
  [csvParser.mimeType]: csvParser,
  [htmlParser.mimeType]: htmlParser,
};

export function getDocumentParser(mimeType: string): DocumentParser | null {
  return PARSERS[mimeType] ?? null;
}
