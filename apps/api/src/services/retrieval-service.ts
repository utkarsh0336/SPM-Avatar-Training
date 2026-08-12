import {
  createEmbeddingProviderFromEnv,
  withOrg,
  type KnowledgeSource,
} from "@avatrain/shared";
import { toVectorLiteral } from "../lib/pgvector.js";

// docs/ARCHITECTURE.md §5's retrieval budget (<100ms p95) and
// .claude/specs/knowledge-management.md's Priority-1/2 vs Priority-3 line —
// below this cosine similarity, "relevant" becomes "noise", and the turn
// falls back to the LLM's own general knowledge (Priority 3).
const DEFAULT_TOP_K = 5;
// Empirically measured against the local embedding model
// (Xenova/all-MiniLM-L6-v2), not guessed: a real resume's chunks scored
// 0.03-0.22 against genuinely relevant questions ("what is my work
// experience?", "what skills do I have?") and -0.08-0.01 against clearly
// unrelated ones ("capital of France?"). This model is a general
// sentence-similarity encoder, not IR-tuned for asymmetric question-vs-
// terse-passage retrieval, so absolute cosine scores run much lower than
// intuition suggests even for strong matches — an earlier 0.35 default
// silently filtered out correct, top-ranked matches on real documents.
// 0.05 sits between the observed noise ceiling and the weakest observed
// real signal; the LLM's own "say so if the context doesn't answer the
// question" instruction (appendKnowledgeContext) is the real backstop
// against a borderline-similar-but-irrelevant chunk slipping through, not
// this constant trying to be a perfect classifier on its own.
const DEFAULT_MIN_SIMILARITY = 0.05;

export interface RetrievedChunk {
  documentId: string;
  documentTitle: string;
  content: string;
  similarity: number;
}

export interface RetrieveContextOptions {
  topK?: number;
  minSimilarity?: number;
}

export interface RetrieveContextDeps {
  createEmbeddingProvider?: typeof createEmbeddingProviderFromEnv;
}

interface ChunkRow {
  content: string;
  document_id: string;
  title: string;
  distance: number;
}

/**
 * Embeds queryText and returns the org's most relevant KnowledgeChunks
 * (most similar first) whose similarity clears minSimilarity. An empty
 * result means "nothing relevant" — Priority-3 territory, not an error.
 * A genuine failure (embedding provider down, DB error) propagates; the
 * caller (conversation-service.ts) is responsible for degrading to
 * ungrounded generation rather than failing the turn — see
 * .claude/rules/realtime.md.
 *
 * org-scoped twice over, deliberately: withOrg sets app.current_org_id so
 * RLS is the real enforcement boundary, and the explicit `WHERE kc.org_id =
 * $orgId` below is belt-and-suspenders (matches every other tenant query in
 * this codebase, e.g. onboarding-service.ts) and lets the planner use the
 * org_id index alongside the HNSW ANN index.
 */
export async function retrieveContext(
  orgId: string,
  queryText: string,
  options: RetrieveContextOptions = {},
  deps: RetrieveContextDeps = {},
): Promise<RetrievedChunk[]> {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const createEmbeddingProvider = deps.createEmbeddingProvider ?? createEmbeddingProviderFromEnv;

  const trimmed = queryText.trim();
  if (!trimmed) return [];

  const provider = createEmbeddingProvider();
  const [queryVector] = await provider.embed([trimmed]);
  if (!queryVector) return [];
  const vectorLiteral = toVectorLiteral(queryVector);

  const rows = await withOrg(orgId, (tx) =>
    tx.$queryRaw<ChunkRow[]>`
      SELECT kc.content AS content, kc.document_id AS document_id, kd.title AS title,
             (kc.embedding <=> ${vectorLiteral}::vector) AS distance
      FROM knowledge_chunks kc
      JOIN knowledge_documents kd ON kd.id = kc.document_id
      WHERE kc.org_id = ${orgId}::uuid
      ORDER BY kc.embedding <=> ${vectorLiteral}::vector
      LIMIT ${topK}
    `,
  );

  return rows
    .map((row) => ({
      documentId: row.document_id,
      documentTitle: row.title,
      content: row.content,
      // pgvector's <=> is cosine *distance* (1 - cosine similarity) for
      // vector_cosine_ops — see the HNSW index in
      // prisma/migrations/*_add_knowledge_management.
      similarity: 1 - row.distance,
    }))
    .filter((chunk) => chunk.similarity >= minSimilarity);
}

/** De-duplicated, in-rank-order source list for SOW §3.3 source attribution. */
export function toKnowledgeSources(chunks: RetrievedChunk[]): KnowledgeSource[] {
  const seen = new Set<string>();
  const sources: KnowledgeSource[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.documentId)) continue;
    seen.add(chunk.documentId);
    sources.push({ documentId: chunk.documentId, title: chunk.documentTitle });
  }
  return sources;
}
