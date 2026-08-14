"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
  updateKnowledgeDocument,
  uploadKnowledgeDocument,
  type KnowledgeDocumentResult,
  type UpdateKnowledgeDocumentInput,
} from "../../../lib/api-client";
import { DocumentList } from "./DocumentList";
import { DocumentMetadataEditor } from "./DocumentMetadataEditor";
import { DocumentUpload } from "./DocumentUpload";
import { KnowledgeSearch } from "./KnowledgeSearch";
import { VersionHistory } from "./VersionHistory";
import styles from "./page.module.css";

const POLL_INTERVAL_MS = 3000;

function hasInFlightDocument(documents: KnowledgeDocumentResult[]): boolean {
  return documents.some((doc) => doc.status === "PENDING" || doc.status === "PROCESSING");
}

function humanizeUploadError(code: string): string {
  switch (code) {
    case "unsupported_mime_type":
      return "That file type isn't supported — try PDF, DOCX, TXT, PPTX, XLSX, CSV, or HTML.";
    case "file_too_large":
      return "That file is too large — the limit is 25MB.";
    case "invalid_tags":
      return "Tags must be up to 20 short labels.";
    default:
      return "Upload failed. Please try again.";
  }
}

/**
 * Stateful orchestrator — DocumentUpload/DocumentList are presentational,
 * this owns fetch/poll/upload/delete/edit/version-history so any action
 * immediately refreshes what the children render. Client-only (unlike
 * settings' BrandingForm, which reloads the whole page on save) since the
 * document list needs to keep updating on its own while ingestion runs in
 * the background — see .claude/specs/knowledge-management.md's UI Changes.
 *
 * Category/tag filtering is applied client-side against the full,
 * unfiltered fetch (not re-queried from the server per filter change) —
 * see api-client.ts's listKnowledgeDocuments doc comment for why: it keeps
 * the filter option set from narrowing to only what's currently visible.
 */
export function KnowledgeBase() {
  const [documents, setDocuments] = useState<KnowledgeDocumentResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [historyDocumentId, setHistoryDocumentId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string[]>([]);

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
  // WebSocket) is proportionate to the need. listDocuments() surfaces the
  // highest-version row per lineage, so an in-flight re-upload via
  // VersionHistory is already covered by this same check.
  useEffect(() => {
    if (!hasInFlightDocument(documents)) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [documents, refresh]);

  const availableCategories = useMemo(
    () => Array.from(new Set(documents.map((doc) => doc.category).filter((c): c is string => Boolean(c)))).sort(),
    [documents],
  );
  const availableTags = useMemo(
    () => Array.from(new Set(documents.flatMap((doc) => doc.tags))).sort(),
    [documents],
  );
  const filteredDocuments = useMemo(
    () =>
      documents.filter((doc) => {
        if (categoryFilter !== null && doc.category !== categoryFilter) return false;
        if (tagFilter.length > 0 && !tagFilter.some((tag) => doc.tags.includes(tag))) return false;
        return true;
      }),
    [documents, categoryFilter, tagFilter],
  );

  async function handleUpload(file: File, category: string | undefined, tags: string[]): Promise<void> {
    setUploading(true);
    setUploadError(null);
    try {
      await uploadKnowledgeDocument(file, { category, tags });
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

  async function handleSaveMetadata(documentId: string, patch: UpdateKnowledgeDocumentInput): Promise<void> {
    await updateKnowledgeDocument(documentId, patch);
    await refresh();
  }

  function handleTagFilterToggle(tag: string): void {
    setTagFilter((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));
  }

  const editingDocument = documents.find((doc) => doc.id === editingDocumentId) ?? null;

  return (
    <div className={styles.body}>
      <DocumentUpload onUpload={handleUpload} uploading={uploading} error={uploadError} />

      <KnowledgeSearch />

      {editingDocument && (
        <DocumentMetadataEditor
          document={editingDocument}
          onSave={(patch) => handleSaveMetadata(editingDocument.id, patch)}
          onClose={() => setEditingDocumentId(null)}
        />
      )}

      {historyDocumentId && (
        <VersionHistory
          documentId={historyDocumentId}
          onClose={() => setHistoryDocumentId(null)}
          onRestored={() => void refresh()}
        />
      )}

      {loaded && (
        <DocumentList
          documents={filteredDocuments}
          onDelete={(id) => void handleDelete(id)}
          deletingId={deletingId}
          onEdit={setEditingDocumentId}
          onOpenHistory={setHistoryDocumentId}
          availableCategories={availableCategories}
          availableTags={availableTags}
          categoryFilter={categoryFilter}
          tagFilter={tagFilter}
          onCategoryFilterChange={setCategoryFilter}
          onTagFilterToggle={handleTagFilterToggle}
        />
      )}
    </div>
  );
}
