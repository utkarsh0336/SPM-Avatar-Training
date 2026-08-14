"use client";

import { useState, type FormEvent } from "react";
import type { KnowledgeDocumentResult, UpdateKnowledgeDocumentInput } from "../../../lib/api-client";
import { CloseIcon } from "../../sessions/icons";
import styles from "./page.module.css";

export interface DocumentMetadataEditorProps {
  document: KnowledgeDocumentResult;
  onSave: (patch: UpdateKnowledgeDocumentInput) => Promise<void>;
  onClose: () => void;
}

export function DocumentMetadataEditor({ document, onSave, onClose }: DocumentMetadataEditorProps) {
  const [category, setCategory] = useState(document.category ?? "");
  const [tagsInput, setTagsInput] = useState(document.tags.join(", "));
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    try {
      const trimmedCategory = category.trim();
      const tags = tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
      await onSave({ category: trimmedCategory.length > 0 ? trimmedCategory : null, tags });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={(event) => void handleSubmit(event)}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Edit “{document.title}”</span>
        <button type="button" className={styles.panelCloseButton} aria-label="Close" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>
      <label className={styles.panelLabel}>
        Category
        <input
          type="text"
          className={styles.uploadTextInput}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          disabled={saving}
        />
      </label>
      <label className={styles.panelLabel}>
        Tags, comma separated
        <input
          type="text"
          className={styles.uploadTextInput}
          value={tagsInput}
          onChange={(event) => setTagsInput(event.target.value)}
          disabled={saving}
        />
      </label>
      <div className={styles.panelActions}>
        <button type="button" className={styles.panelSecondaryButton} onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className={styles.uploadSubmitButton} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
