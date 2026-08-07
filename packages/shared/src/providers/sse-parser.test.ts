import { describe, expect, it } from "vitest";
import { parseSseStream } from "./sse-parser.js";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const payload of parseSseStream(stream)) out.push(payload);
  return out;
}

describe("parseSseStream", () => {
  it("yields the payload of each data: line", async () => {
    const stream = streamFromChunks(['data: {"a":1}\n\n', 'data: {"a":2}\n\n']);
    expect(await collect(stream)).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("handles a data: line split across multiple chunks", async () => {
    const stream = streamFromChunks(['data: {"a":', '1}\n']);
    expect(await collect(stream)).toEqual(['{"a":1}']);
  });

  it("ignores non-data lines (event:, comments, blank lines)", async () => {
    const stream = streamFromChunks(["event: message\n", ": a comment\n", "\n", "data: hello\n"]);
    expect(await collect(stream)).toEqual(["hello"]);
  });

  it("passes through a literal [DONE] payload for the caller to handle", async () => {
    const stream = streamFromChunks(["data: [DONE]\n"]);
    expect(await collect(stream)).toEqual(["[DONE]"]);
  });

  it("returns nothing for an empty stream", async () => {
    const stream = streamFromChunks([]);
    expect(await collect(stream)).toEqual([]);
  });
});
