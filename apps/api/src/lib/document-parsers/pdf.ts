import { PDFParse } from "pdf-parse";
import type { DocumentParser } from "./types.js";

export const pdfParser: DocumentParser = {
  mimeType: "application/pdf",
  async parse(fileBytes: Buffer): Promise<string> {
    const parser = new PDFParse({ data: fileBytes });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  },
};
