import type { DocumentParser } from "./types.js";

/**
 * Minimal RFC4180-aware tokenizer — same "hand-roll a small parser"
 * precedent as ../../../../packages/shared/src/knowledge/chunking.ts.
 * Handles quoted fields (embedded commas/newlines) and "" as an escaped
 * literal quote.
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-blank trailing/interior rows (a lone empty field from a
  // trailing newline), matching what a human reading the source CSV would
  // consider "no more data".
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export const csvParser: DocumentParser = {
  mimeType: "text/csv",
  async parse(fileBytes: Buffer): Promise<string> {
    const rows = parseCsvRows(fileBytes.toString("utf-8"));
    if (rows.length === 0) return "";

    const [headerRow, ...dataRows] = rows;
    return dataRows
      .map((row) => headerRow!.map((header, i) => `${header}: ${row[i] ?? ""}`).join("; "))
      .join("\n");
  },
};
