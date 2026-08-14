import { describe, expect, it } from "vitest";
import { htmlParser } from "./html.js";

describe("htmlParser", () => {
  it("reports its mime type", () => {
    expect(htmlParser.mimeType).toBe("text/html");
  });

  it("strips tags and converts block-level closing tags to newlines", async () => {
    const bytes = Buffer.from("<html><body><p>First paragraph.</p><p>Second paragraph.</p></body></html>");

    const text = await htmlParser.parse(bytes);

    expect(text).toBe("First paragraph.\nSecond paragraph.");
  });

  it("drops script and style blocks entirely, including their content", async () => {
    const bytes = Buffer.from(
      "<html><head><style>body { color: red; }</style></head><body><script>alert('hi');</script><p>Visible text</p></body></html>",
    );

    const text = await htmlParser.parse(bytes);

    expect(text).toBe("Visible text");
  });

  it("decodes common HTML entities", async () => {
    const bytes = Buffer.from("<p>Terms &amp; Conditions &mdash; &quot;final&quot;</p>");

    const text = await htmlParser.parse(bytes);

    expect(text).toBe('Terms & Conditions &mdash; "final"');
  });

  it("collapses excess whitespace and blank lines", async () => {
    const bytes = Buffer.from("<div>  <p>Line one</p>\n\n\n<p>   Line two   </p>  </div>");

    const text = await htmlParser.parse(bytes);

    expect(text).toBe("Line one\nLine two");
  });

  it("converts <br> and <hr> to newlines", async () => {
    const bytes = Buffer.from("<p>Line one<br>Line two<hr>Line three</p>");

    const text = await htmlParser.parse(bytes);

    expect(text).toBe("Line one\nLine two\nLine three");
  });
});
