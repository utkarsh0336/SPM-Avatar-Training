"use client";

import { useState, type FormEvent } from "react";
import { ApiError, searchKnowledge, type KnowledgeSearchResponse } from "../../../lib/api-client";
import { SearchIcon } from "../../sessions/icons";
import styles from "./page.module.css";

type SearchResult = KnowledgeSearchResponse["results"][number];

/**
 * Standalone diagnostic search over the org's indexed knowledge, outside a
 * live conversation turn — see .claude/specs/knowledge-search-and-
 * ingestion-queue.md's Business Goal. Read-only and independent of
 * KnowledgeBase's upload/list/edit/version state.
 *
 * results is null until a query has actually run — distinct from [] (a
 * query ran and matched nothing), since the latter is real diagnostic
 * signal worth showing distinctly ("this content genuinely isn't
 * searchable for that phrasing" vs. "no query yet").
 */
export function KnowledgeSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    try {
      const response = await searchKnowledge(trimmed);
      setResults(response.results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Search failed. Please try again.");
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Search knowledge base</span>
      </div>
      <form className={styles.filterRow} onSubmit={(event) => void handleSubmit(event)}>
        <input
          type="text"
          className={styles.uploadTextInput}
          placeholder="What would the avatar be asked?"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={searching}
          aria-label="Search query"
        />
        <button type="submit" className={styles.uploadSubmitButton} disabled={searching || !query.trim()}>
          <SearchIcon size={14} />
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {results !== null &&
        (results.length === 0 ? (
          <p className={styles.empty}>No matches — this content isn't searchable for that phrasing.</p>
        ) : (
          <ul className={styles.list}>
            {results.map((result, index) => (
              <li key={`${result.documentId}-${index}`} className={styles.listItem}>
                <div className={styles.listMeta}>
                  <span className={styles.listTitle}>{result.title}</span>
                  <p className={styles.searchResultContent}>{result.content}</p>
                  <span className={styles.listSubtitle}>similarity {result.similarity.toFixed(3)}</span>
                </div>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
