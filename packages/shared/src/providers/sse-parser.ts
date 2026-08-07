/**
 * Minimal hand-rolled SSE line parser (no library — see the plan's "no SSE
 * library" decision). Yields the raw payload of each `data:` line; callers
 * JSON.parse it themselves and handle a literal "[DONE]" sentinel where the
 * provider sends one (Groq/OpenAI-compatible streams do, Gemini doesn't).
 */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data:")) {
          yield line.slice("data:".length).trim();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
