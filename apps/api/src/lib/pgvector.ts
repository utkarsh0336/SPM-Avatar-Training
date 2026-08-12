/**
 * Formats an embedding as pgvector's text input literal (`[0.1,0.2,...]`).
 * Prisma has no native vector type — every KnowledgeChunk.embedding read or
 * write goes through $queryRaw/$executeRaw, casting this string with
 * `::vector`. Safe against injection because Prisma's tagged-template raw
 * queries bind interpolated values as parameters, never string-concatenate
 * them — the numbers here came from an EmbeddingProvider, not user input,
 * but the binding is what actually makes it safe, not that fact.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
