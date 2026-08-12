import mammoth from "mammoth";
import type { DocumentParser } from "./types.js";

export const docxParser: DocumentParser = {
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  async parse(fileBytes: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer: fileBytes });
    return result.value;
  },
};
