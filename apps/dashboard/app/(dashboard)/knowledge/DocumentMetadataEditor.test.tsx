import { describe, expect, it } from "vitest";
import { DocumentMetadataEditor } from "./DocumentMetadataEditor";

describe("DocumentMetadataEditor", () => {
  it("exports a component", () => {
    expect(typeof DocumentMetadataEditor).toBe("function");
  });
});
