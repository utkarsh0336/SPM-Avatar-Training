"use client";

import { useRef, type ChangeEvent } from "react";
import { UploadIcon } from "../../sessions/icons";
import styles from "./page.module.css";

export interface DocumentUploadProps {
  onUpload: (file: File) => Promise<void>;
  uploading: boolean;
  error: string | null;
}

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.txt";

export function DocumentUpload({ onUpload, uploading, error }: DocumentUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    await onUpload(file);
    // Reset so the same filename can be re-selected after a failed upload.
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className={styles.uploadCard}>
      <input
        ref={inputRef}
        id="knowledge-upload"
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className={styles.uploadInput}
        onChange={(event) => void handleChange(event)}
        disabled={uploading}
      />
      <label htmlFor="knowledge-upload" className={styles.uploadLabel}>
        <UploadIcon size={20} />
        <span>{uploading ? "Uploading…" : "Upload a document"}</span>
        <span className={styles.uploadHint}>PDF, DOCX, or TXT — up to 25MB</span>
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
