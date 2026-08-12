import type { DocumentParser } from "./types.js";

export const txtParser: DocumentParser = {
  mimeType: "text/plain",
  async parse(fileBytes: Buffer): Promise<string> {
    return fileBytes.toString("utf-8");
  },
};
