"use client";

import type { KnowledgeDocumentResult } from "../../../lib/api-client";
import { ClockIcon, FileTextIcon, PencilIcon, TrashIcon } from "../../sessions/icons";
import styles from "./page.module.css";

export interface DocumentListProps {
  documents: KnowledgeDocumentResult[];
  onDelete: (documentId: string) => void;
  deletingId: string | null;
  onEdit: (documentId: string) => void;
  onOpenHistory: (documentId: string) => void;
  availableCategories: string[];
  availableTags: string[];
  categoryFilter: string | null;
  tagFilter: string[];
  onCategoryFilterChange: (category: string | null) => void;
  onTagFilterToggle: (tag: string) => void;
}

const STATUS_LABEL: Record<KnowledgeDocumentResult["status"], string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  INDEXED: "Indexed",
  FAILED: "Failed",
};

// string | undefined, not string: noUncheckedIndexedAccess treats
// page.module.css's default export as index-signature-typed, so property
// access (not just obj[key]) comes back possibly-undefined even though all
// four keys are always covered here.
const STATUS_CLASS: Record<KnowledgeDocumentResult["status"], string | undefined> = {
  PENDING: styles.statusPending,
  PROCESSING: styles.statusProcessing,
  INDEXED: styles.statusIndexed,
  FAILED: styles.statusFailed,
};

export function DocumentList({
  documents,
  onDelete,
  deletingId,
  onEdit,
  onOpenHistory,
  availableCategories,
  availableTags,
  categoryFilter,
  tagFilter,
  onCategoryFilterChange,
  onTagFilterToggle,
}: DocumentListProps) {
  const showFilters = availableCategories.length > 0 || availableTags.length > 0;

  return (
    <div className={styles.listSection}>
      {showFilters && (
        <div className={styles.filterRow}>
          {availableCategories.length > 0 && (
            <select
              className={styles.filterSelect}
              value={categoryFilter ?? ""}
              onChange={(event) => onCategoryFilterChange(event.target.value || null)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {availableCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          )}
          {availableTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={[styles.filterTagButton, tagFilter.includes(tag) ? styles.filterTagButtonActive : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onTagFilterToggle(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {documents.length === 0 ? (
        <p className={styles.empty}>No documents uploaded yet.</p>
      ) : (
        <ul className={styles.list}>
          {documents.map((doc) => (
            <li key={doc.id} className={styles.listItem}>
              <FileTextIcon size={18} className={styles.listIcon} />
              <div className={styles.listMeta}>
                <span className={styles.listTitle}>
                  {doc.title}
                  <span className={styles.versionBadge}>v{doc.version}</span>
                </span>
                <span className={styles.listSubtitle}>
                  {doc.originalFilename} · {doc.chunkCount} {doc.chunkCount === 1 ? "chunk" : "chunks"}
                </span>
                {(doc.category || doc.tags.length > 0) && (
                  <span className={styles.metaChipRow}>
                    {doc.category && <span className={styles.categoryChip}>{doc.category}</span>}
                    {doc.tags.map((tag) => (
                      <span key={tag} className={styles.tagChip}>
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
                {doc.status === "FAILED" && doc.errorMessage && (
                  <span className={styles.listError}>{doc.errorMessage}</span>
                )}
              </div>
              <span className={[styles.statusBadge, STATUS_CLASS[doc.status]].filter(Boolean).join(" ")}>
                {STATUS_LABEL[doc.status]}
              </span>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Edit ${doc.title}`}
                onClick={() => onEdit(doc.id)}
              >
                <PencilIcon size={14} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`View version history for ${doc.title}`}
                onClick={() => onOpenHistory(doc.id)}
              >
                <ClockIcon size={14} />
              </button>
              <button
                type="button"
                className={styles.deleteButton}
                aria-label={`Delete ${doc.title}`}
                disabled={deletingId === doc.id}
                onClick={() => onDelete(doc.id)}
              >
                <TrashIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
