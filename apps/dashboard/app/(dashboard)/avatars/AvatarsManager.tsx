"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AvatarRecord } from "@avatrain/shared/avatar";
import { ApiError, archiveAvatar, createAvatar, listOrgAvatars, publishAvatar } from "../../../lib/api-client";
import { EXPERTISE_LABELS, GENDER_LABELS } from "../../onboarding/types";
import styles from "./page.module.css";

const STATUS_STYLE: Record<AvatarRecord["status"], string | undefined> = {
  ACTIVE: styles.statusActive,
  DRAFT: styles.statusDraft,
  ARCHIVED: styles.statusArchived,
};

/**
 * Stateful orchestrator for the persona list, same shape as
 * (dashboard)/knowledge/KnowledgeBase.tsx: this owns fetch/create/publish/
 * archive so an action immediately refreshes what the grid renders.
 */
export function AvatarsManager() {
  const router = useRouter();
  const [avatars, setAvatars] = useState<AvatarRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await listOrgAvatars();
    setAvatars(result.avatars);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate(): Promise<void> {
    setCreating(true);
    setError(null);
    try {
      const created = await createAvatar();
      router.push(`/avatars/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.body.message ?? "Could not create a new persona.") : "Could not reach the server.");
      setCreating(false);
    }
  }

  async function handlePublish(avatarId: string): Promise<void> {
    setPendingId(avatarId);
    setError(null);
    try {
      await publishAvatar(avatarId);
      await refresh();
    } catch (err) {
      const fields = err instanceof ApiError ? err.body.fields : undefined;
      const detail = fields?.length ? ` Missing: ${fields.map((f) => f.path).join(", ")}.` : "";
      setError(
        err instanceof ApiError
          ? `${err.body.message ?? "Could not publish this persona."}${detail}`
          : "Could not reach the server.",
      );
    } finally {
      setPendingId(null);
    }
  }

  async function handleArchive(avatarId: string): Promise<void> {
    setPendingId(avatarId);
    setError(null);
    try {
      await archiveAvatar(avatarId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.body.message ?? "Could not archive this persona.") : "Could not reach the server.");
    } finally {
      setPendingId(null);
    }
  }

  if (!loaded) return null;

  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {avatars.length} persona{avatars.length === 1 ? "" : "s"}
        </span>
        <button type="button" className={styles.newButton} onClick={() => void handleCreate()} disabled={creating}>
          {creating ? "Creating…" : "+ New Persona"}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {avatars.length === 0 ? (
        <div className={styles.empty}>No personas yet — create one to get started.</div>
      ) : (
        <div className={styles.grid}>
          {avatars.map((avatar) => (
            <div key={avatar.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.cardName}>{avatar.name || "Untitled Avatar"}</div>
                  <div className={styles.cardMeta}>
                    {avatar.gender ? GENDER_LABELS[avatar.gender] : "No gender set"}
                    {avatar.expertise ? ` · ${EXPERTISE_LABELS[avatar.expertise]}` : ""}
                  </div>
                </div>
                <span className={STATUS_STYLE[avatar.status]}>{avatar.status}</span>
              </div>

              <div className={styles.cardActions}>
                <button type="button" className={styles.actionButton} onClick={() => router.push(`/avatars/${avatar.id}`)}>
                  Edit
                </button>
                {avatar.status !== "ACTIVE" && (
                  <button
                    type="button"
                    className={styles.actionButtonPrimary}
                    onClick={() => void handlePublish(avatar.id)}
                    disabled={pendingId === avatar.id}
                  >
                    Publish
                  </button>
                )}
                {avatar.status !== "ARCHIVED" && (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => void handleArchive(avatar.id)}
                    disabled={pendingId === avatar.id}
                  >
                    Archive
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
