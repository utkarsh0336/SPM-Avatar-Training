"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { UploadIcon } from "../../sessions/icons";
import styles from "./page.module.css";

export interface DocumentUploadProps {
  onUpload: (file: File, category: string | undefined, tags: string[]) => Promise<void>;
  uploading: boolean;
  error: string | null;
}

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.txt,.pptx,.xlsx,.csv,.html";

function parseTagsInput(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function DocumentUpload({ onUpload, uploading, error }: DocumentUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file) setPendingFile(file);
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!pendingFile) return;
    await onUpload(pendingFile, category.trim() || undefined, parseTagsInput(tagsInput));
    setPendingFile(null);
    setCategory("");
    setTagsInput("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <form className={styles.uploadCard} onSubmit={(event) => void handleSubmit(event)}>
      <input
        ref={inputRef}
        id="knowledge-upload"
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className={styles.uploadInput}
        onChange={handleChange}
        disabled={uploading}
      />
      <label htmlFor="knowledge-upload" className={styles.uploadLabel}>
        <UploadIcon size={20} />
        <span>{pendingFile ? pendingFile.name : "Choose a document"}</span>
        <span className={styles.uploadHint}>PDF, DOCX, TXT, PPTX, XLSX, CSV, or HTML — up to 25MB</span>
      </label>

      {pendingFile && (
        <div className={styles.uploadMetaFields}>
          <input
            type="text"
            className={styles.uploadTextInput}
            placeholder="Category (optional)"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={uploading}
            aria-label="Category"
          />
          <input
            type="text"
            className={styles.uploadTextInput}
            placeholder="Tags, comma separated (optional)"
            value={tagsInput}
            onChange={(event) => setTagsInput(event.target.value)}
            disabled={uploading}
            aria-label="Tags"
          />
          <button type="submit" className={styles.uploadSubmitButton} disabled={uploading}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
