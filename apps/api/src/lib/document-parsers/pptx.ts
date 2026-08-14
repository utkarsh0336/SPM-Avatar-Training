import { parseOfficeAsync } from "officeparser";
import type { DocumentParser } from "./types.js";

export const pptxParser: DocumentParser = {
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  async parse(fileBytes: Buffer): Promise<string> {
    return parseOfficeAsync(fileBytes);
  },
};
