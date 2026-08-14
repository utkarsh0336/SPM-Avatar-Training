"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ApiError,
  listKnowledgeDocumentVersions,
  restoreKnowledgeDocumentVersion,
  uploadKnowledgeDocumentVersion,
  type KnowledgeDocumentVersionResult,
} from "../../../lib/api-client";
import { CloseIcon, UploadIcon } from "../../sessions/icons";
import styles from "./page.module.css";

export interface VersionHistoryProps {
  documentId: string;
  onClose: () => void;
  onRestored: () => void;
}

const POLL_INTERVAL_MS = 3000;

const STATUS_LABEL: Record<KnowledgeDocumentVersionResult["status"], string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  INDEXED: "Indexed",
  FAILED: "Failed",
};

function hasInFlightVersion(versions: KnowledgeDocumentVersionResult[]): boolean {
  return versions.some((v) => v.status === "PENDING" || v.status === "PROCESSING");
}

/**
 * Owns its own fetch/poll loop rather than sharing KnowledgeBase's — it
 * shows every version in a lineage, a larger and differently-scoped set
 * than the main (highest-version-per-lineage) document list.
 */
export function VersionHistory({ documentId, onClose, onRestored }: VersionHistoryProps) {
  const [versions, setVersions] = useState<KnowledgeDocumentVersionResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const result = await listKnowledgeDocumentVersions(documentId);
    setVersions(result.versions);
    setLoaded(true);
  }, [documentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!hasInFlightVersion(versions)) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [versions, refresh]);

  async function handleUploadVersion(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadKnowledgeDocumentVersion(documentId, file);
      await refresh();
      onRestored();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRestore(versionId: string): Promise<void> {
    setRestoringId(versionId);
    setError(null);
    try {
      await restoreKnowledgeDocumentVersion(documentId, versionId);
      await refresh();
      onRestored();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Restore failed. Please try again.");
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Version history</span>
        <button type="button" className={styles.panelCloseButton} aria-label="Close" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>

      <div className={styles.uploadCard}>
        <input
          ref={inputRef}
          id="knowledge-version-upload"
          type="file"
          accept=".pdf,.docx,.txt,.pptx,.xlsx,.csv,.html"
          className={styles.uploadInput}
          onChange={(event) => void handleUploadVersion(event)}
          disabled={uploading}
        />
        <label htmlFor="knowledge-version-upload" className={styles.uploadLabel}>
          <UploadIcon size={18} />
          <span>{uploading ? "Uploading…" : "Upload a new version"}</span>
        </label>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {loaded && (
        <ul className={styles.versionList}>
          {versions.map((version) => (
            <li key={version.id} className={styles.versionListItem}>
              <div className={styles.listMeta}>
                <span className={styles.listTitle}>
                  v{version.version}
                  {version.isLatest && <span className={styles.versionCurrentTag}>current</span>}
                </span>
                <span className={styles.listSubtitle}>
                  {version.originalFilename} · {new Date(version.createdAt).toLocaleString()}
                </span>
              </div>
              <span className={styles.statusBadge}>{STATUS_LABEL[version.status]}</span>
              {!version.isLatest && version.status === "INDEXED" && (
                <button
                  type="button"
                  className={styles.panelSecondaryButton}
                  disabled={restoringId === version.id}
                  onClick={() => void handleRestore(version.id)}
                >
                  {restoringId === version.id ? "Restoring…" : "Restore"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
