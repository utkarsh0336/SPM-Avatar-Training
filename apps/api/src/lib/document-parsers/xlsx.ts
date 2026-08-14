import { read, utils } from "xlsx";
import type { DocumentParser } from "./types.js";

export const xlsxParser: DocumentParser = {
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  async parse(fileBytes: Buffer): Promise<string> {
    const workbook = read(fileBytes, { type: "buffer" });
    const sections = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const csv = sheet ? utils.sheet_to_csv(sheet).trim() : "";
      return `# ${sheetName}\n${csv}`;
    });
    return sections.join("\n\n");
  },
};
