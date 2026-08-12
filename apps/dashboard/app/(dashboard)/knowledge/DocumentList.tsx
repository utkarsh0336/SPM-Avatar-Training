"use client";

import type { KnowledgeDocumentResult } from "../../../lib/api-client";
import { FileTextIcon, TrashIcon } from "../../sessions/icons";
import styles from "./page.module.css";

export interface DocumentListProps {
  documents: KnowledgeDocumentResult[];
  onDelete: (documentId: string) => void;
  deletingId: string | null;
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

export function DocumentList({ documents, onDelete, deletingId }: DocumentListProps) {
  if (documents.length === 0) {
    return <p className={styles.empty}>No documents uploaded yet.</p>;
  }

  return (
    <ul className={styles.list}>
      {documents.map((doc) => (
        <li key={doc.id} className={styles.listItem}>
          <FileTextIcon size={18} className={styles.listIcon} />
          <div className={styles.listMeta}>
            <span className={styles.listTitle}>{doc.title}</span>
            <span className={styles.listSubtitle}>
              {doc.originalFilename} · {doc.chunkCount} {doc.chunkCount === 1 ? "chunk" : "chunks"}
            </span>
            {doc.status === "FAILED" && doc.errorMessage && (
              <span className={styles.listError}>{doc.errorMessage}</span>
            )}
          </div>
          <span className={[styles.statusBadge, STATUS_CLASS[doc.status]].filter(Boolean).join(" ")}>
            {STATUS_LABEL[doc.status]}
          </span>
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
  );
}
