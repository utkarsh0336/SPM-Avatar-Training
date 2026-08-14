"use client";

import { useEffect, useState } from "react";
import { completeChecklistItem, getAvatar, getChecklist } from "../../../lib/api-client";
import type { ChecklistResult } from "@avatrain/shared/curriculum";
import sideStyles from "./SidePanel.module.css";
import styles from "./ChecklistPanel.module.css";

interface ChecklistPanelProps {
  avatarId?: string | null;
}

/**
 * Companion to the checkpoint/grading feedback this side panel already
 * surfaces — a structured, non-conversational task list the learner checks
 * off directly, distinct from the AI-graded Objective checkpoints. Resolves
 * curriculumId from avatarId (GET /v1/avatars/:avatarId now includes it,
 * see avatar-service.ts's getAvatarById) since a rehearsal session only
 * ever knows its avatarId. Renders nothing if the avatar has no curriculum,
 * or the curriculum has no checklist, or the checklist has no items —
 * matching interactive-assessment.md's own "silent no-op, not an error"
 * convention for a missing curriculum. See
 * .claude/specs/induction-checklist.md's UI Changes.
 */
export function ChecklistPanel({ avatarId }: ChecklistPanelProps) {
  const [checklist, setChecklist] = useState<ChecklistResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setChecklist(null);

    if (!avatarId) {
      setLoaded(true);
      return;
    }

    void (async () => {
      const avatar = await getAvatar(avatarId).catch(() => null);
      const curriculumId = avatar?.curriculumId;
      const loadedChecklist = curriculumId ? await getChecklist(curriculumId).catch(() => null) : null;
      if (!cancelled) {
        setChecklist(loadedChecklist);
        setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [avatarId]);

  async function handleToggle(itemId: string, completed: boolean): Promise<void> {
    if (!checklist) return;
    setPendingItemId(itemId);
    setChecklist({
      ...checklist,
      items: checklist.items.map((item) => (item.id === itemId ? { ...item, completed } : item)),
    });
    try {
      await completeChecklistItem(itemId, completed);
    } catch {
      // Reconcile with server truth on failure — optimistic flip was wrong.
      setChecklist((prev) =>
        prev
          ? { ...prev, items: prev.items.map((item) => (item.id === itemId ? { ...item, completed: !completed } : item)) }
          : prev,
      );
    } finally {
      setPendingItemId(null);
    }
  }

  if (!loaded || !checklist || checklist.items.length === 0) return null;

  return (
    <div>
      <div className={sideStyles.sectionLabel}>CHECKLIST — {checklist.title}</div>
      <div className={styles.list}>
        {checklist.items.map((item) => (
          <label key={item.id} className={styles.row}>
            <input
              type="checkbox"
              checked={item.completed}
              disabled={pendingItemId === item.id}
              onChange={(e) => void handleToggle(item.id, e.target.checked)}
            />
            <span className={item.completed ? styles.titleDone : styles.title}>{item.title}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
