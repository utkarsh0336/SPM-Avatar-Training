"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
  uploadKnowledgeDocument,
  type KnowledgeDocumentResult,
} from "../../../lib/api-client";
import { DocumentList } from "./DocumentList";
import { DocumentUpload } from "./DocumentUpload";
import styles from "./page.module.css";

const POLL_INTERVAL_MS = 3000;

function hasInFlightDocument(documents: KnowledgeDocumentResult[]): boolean {
  return documents.some((doc) => doc.status === "PENDING" || doc.status === "PROCESSING");
}

function humanizeUploadError(code: string): string {
  switch (code) {
    case "unsupported_mime_type":
      return "That file type isn't supported yet — try PDF, DOCX, or TXT.";
    case "file_too_large":
      return "That file is too large — the limit is 25MB.";
    default:
      return "Upload failed. Please try again.";
  }
}

/**
 * Stateful orchestrator — DocumentUpload/DocumentList are presentational,
 * this owns fetch/poll/upload/delete so an upload or delete immediately
 * refreshes what both children render. Client-only (unlike settings'
 * BrandingForm, which reloads the whole page on save) since the document
 * list needs to keep updating on its own while ingestion runs in the
 * background — see .claude/specs/knowledge-management.md's UI Changes.
 */
export function KnowledgeBase() {
  const [documents, setDocuments] = useState<KnowledgeDocumentResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await listKnowledgeDocuments();
    setDocuments(result.documents);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Polls only while something is actually in flight — this is an admin
  // screen, not the realtime audio path, so plain polling (not a
  // WebSocket) is proportionate to the need.
  useEffect(() => {
    if (!hasInFlightDocument(documents)) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [documents, refresh]);

  async function handleUpload(file: File): Promise<void> {
    setUploading(true);
    setUploadError(null);
    try {
      await uploadKnowledgeDocument(file);
      await refresh();
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? humanizeUploadError(err.body.error) : "Upload failed. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(documentId: string): Promise<void> {
    setDeletingId(documentId);
    try {
      await deleteKnowledgeDocument(documentId);
      await refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className={styles.body}>
      <DocumentUpload onUpload={handleUpload} uploading={uploading} error={uploadError} />
      {loaded && (
        <DocumentList documents={documents} onDelete={(id) => void handleDelete(id)} deletingId={deletingId} />
      )}
    </div>
  );
}
