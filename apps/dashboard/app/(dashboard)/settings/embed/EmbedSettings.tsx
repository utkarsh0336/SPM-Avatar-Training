"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApplicationRecord } from "@avatrain/shared/application";
import type { AvatarSummary } from "@avatrain/shared/curriculum";
import {
  ApiError,
  createApplication,
  deleteApplication,
  listActiveAvatars,
  listApplications,
  updateApplication,
} from "../../../../lib/api-client";
import styles from "./EmbedSettings.module.css";

/**
 * Stateful orchestrator for the embed configuration list — same shape as
 * (dashboard)/avatars/AvatarsManager.tsx and (dashboard)/knowledge/KnowledgeBase.tsx:
 * owns fetch/create/update/delete so an action immediately refreshes what
 * the list renders. Each card edits its own Application row directly
 * (allowedOrigins as a comma-separated field, avatarId via a picker of the
 * org's published avatars, isEnabled as a toggle) — no separate "edit mode",
 * changes save on blur/change since there are only a handful of fields.
 */
export function EmbedSettings() {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [avatars, setAvatars] = useState<AvatarSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [applicationsResult, avatarsResult] = await Promise.all([listApplications(), listActiveAvatars()]);
    setApplications(applicationsResult.applications);
    setAvatars(avatarsResult.avatars);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate(): Promise<void> {
    setCreating(true);
    setError(null);
    try {
      const created = await createApplication({ name: "New Embed" });
      setApplications((prev) => [created, ...prev]);
    } catch (err) {
      setError(err instanceof ApiError ? (err.body.message ?? "Could not create an embed.") : "Could not reach the server.");
    } finally {
      setCreating(false);
    }
  }

  async function handlePatch(applicationId: string, patch: Parameters<typeof updateApplication>[1]): Promise<void> {
    setError(null);
    try {
      const updated = await updateApplication(applicationId, patch);
      setApplications((prev) => prev.map((app) => (app.id === applicationId ? updated : app)));
    } catch (err) {
      setError(err instanceof ApiError ? (err.body.message ?? "Could not save changes.") : "Could not reach the server.");
    }
  }

  async function handleDelete(applicationId: string): Promise<void> {
    setError(null);
    try {
      await deleteApplication(applicationId);
      setApplications((prev) => prev.filter((app) => app.id !== applicationId));
    } catch (err) {
      setError(err instanceof ApiError ? (err.body.message ?? "Could not delete this embed.") : "Could not reach the server.");
    }
  }

  function handleCopyKey(key: string): void {
    navigator.clipboard?.writeText(key).then(() => {
      setCopiedId(key);
      setTimeout(() => setCopiedId((current) => (current === key ? null : current)), 1500);
    });
  }

  if (!loaded) return null;

  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {applications.length} embed{applications.length === 1 ? "" : "s"}
        </span>
        <button type="button" className={styles.newButton} onClick={() => void handleCreate()} disabled={creating}>
          {creating ? "Creating…" : "+ New Embed"}
        </button>
      </div>

      {error && <p className={styles.snippet}>{error}</p>}

      {applications.length === 0 ? (
        <div className={styles.empty}>No embeds yet — create one to put your AI avatar on a website.</div>
      ) : (
        <div className={styles.list}>
          {applications.map((application) => (
            <ApplicationCard
              key={application.id}
              application={application}
              avatars={avatars}
              copied={copiedId === application.publishableKey}
              onCopyKey={() => handleCopyKey(application.publishableKey)}
              onPatch={(patch) => handlePatch(application.id, patch)}
              onDelete={() => handleDelete(application.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

interface ApplicationCardProps {
  application: ApplicationRecord;
  avatars: AvatarSummary[];
  copied: boolean;
  onCopyKey: () => void;
  onPatch: (patch: Parameters<typeof updateApplication>[1]) => void;
  onDelete: () => void;
}

function ApplicationCard({ application, avatars, copied, onCopyKey, onPatch, onDelete }: ApplicationCardProps) {
  const [name, setName] = useState(application.name);
  const [originsText, setOriginsText] = useState(application.allowedOrigins.join(", "));

  function commitOrigins(): void {
    const origins = originsText
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    onPatch({ allowedOrigins: origins });
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <input
          className={styles.nameInput}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name.trim() && name !== application.name && onPatch({ name: name.trim() })}
        />
        <span className={application.isEnabled ? styles.enabledBadge : styles.disabledBadge}>
          {application.isEnabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      <div className={styles.keyRow}>
        <span>{application.publishableKey}</span>
        <button type="button" className={styles.copyButton} onClick={onCopyKey}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.label}>Persona</span>
          <select
            className={styles.select}
            value={application.avatarId ?? ""}
            onChange={(event) => onPatch({ avatarId: event.target.value || null })}
          >
            <option value="">Not set</option>
            {avatars.map((avatar) => (
              <option key={avatar.id} value={avatar.id}>
                {avatar.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Allowed origins (comma-separated)</span>
          <input
            className={styles.textInput}
            value={originsText}
            onChange={(event) => setOriginsText(event.target.value)}
            onBlur={commitOrigins}
            placeholder="https://example.com, https://app.example.com"
          />
        </label>
      </div>

      <div className={styles.actionsRow}>
        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={application.isEnabled}
            onChange={(event) => onPatch({ isEnabled: event.target.checked })}
          />
          Enabled
        </label>
        <button type="button" className={styles.deleteButton} onClick={onDelete}>
          Delete
        </button>
      </div>

      <pre className={styles.snippet}>
        {`<script src="https://YOUR-EMBED-CDN-URL/v1/embed.js"></script>
<div id="avatrain-widget"></div>
<script>
  window.Avatrain.init({ key: "${application.publishableKey}", target: "#avatrain-widget" });
</script>`}
      </pre>
    </div>
  );
}
