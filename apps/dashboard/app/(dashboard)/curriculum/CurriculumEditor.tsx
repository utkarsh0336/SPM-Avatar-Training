"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createCurriculum,
  deleteCurriculum,
  getCurriculum,
  listActiveAvatars,
  listCurriculumProgress,
  replaceCurriculumObjectives,
} from "../../../lib/api-client";
import type { AvatarSummary, CurriculumResult, ObjectiveInput, ObjectiveProgressEntry } from "@avatrain/shared/curriculum";
import { ObjectiveList, type ObjectiveDraft } from "./ObjectiveList";
import { ProgressTable } from "./ProgressTable";
import styles from "./page.module.css";

function toDrafts(curriculum: CurriculumResult): ObjectiveDraft[] {
  return curriculum.objectives.map((objective) => ({
    key: objective.id,
    id: objective.id,
    title: objective.title,
    teachingContent: objective.teachingContent,
    checkQuestion: objective.checkQuestion,
    gradingCriteria: objective.gradingCriteria,
  }));
}

function humanizeError(err: unknown): string {
  if (err instanceof ApiError) return err.body.message ?? err.body.error;
  return "Something went wrong. Please try again.";
}

/**
 * Stateful orchestrator, mirroring KnowledgeBase.tsx's shape: owns
 * fetch/save state, delegates rendering to ObjectiveList/ProgressTable. No
 * polling — authoring and viewing progress are on-demand actions here,
 * unlike Knowledge Base's async-ingestion-status screen. See
 * .claude/specs/interactive-assessment.md's UI Changes.
 */
export function CurriculumEditor() {
  const [avatars, setAvatars] = useState<AvatarSummary[]>([]);
  const [avatarsLoaded, setAvatarsLoaded] = useState(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
  const [curriculum, setCurriculum] = useState<CurriculumResult | null>(null);
  const [objectives, setObjectives] = useState<ObjectiveDraft[]>([]);
  const [progress, setProgress] = useState<ObjectiveProgressEntry[]>([]);
  const [newCurriculumTitle, setNewCurriculumTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAvatars = useCallback(async () => {
    const result = await listActiveAvatars();
    setAvatars(result.avatars);
    setAvatarsLoaded(true);
    return result.avatars;
  }, []);

  useEffect(() => {
    void refreshAvatars().then((loaded) => {
      if (loaded.length > 0) setSelectedAvatarId((current) => current ?? loaded[0]!.id);
    });
  }, [refreshAvatars]);

  const selectedAvatar = avatars.find((avatar) => avatar.id === selectedAvatarId) ?? null;

  const loadCurriculumFor = useCallback(async (curriculumId: string) => {
    const [loadedCurriculum, loadedProgress] = await Promise.all([
      getCurriculum(curriculumId),
      listCurriculumProgress(curriculumId),
    ]);
    setCurriculum(loadedCurriculum);
    setObjectives(toDrafts(loadedCurriculum));
    setProgress(loadedProgress.progress);
  }, []);

  useEffect(() => {
    setError(null);
    if (!selectedAvatar) {
      setCurriculum(null);
      setObjectives([]);
      setProgress([]);
      return;
    }
    if (!selectedAvatar.curriculumId) {
      setCurriculum(null);
      setObjectives([]);
      setProgress([]);
      return;
    }
    void loadCurriculumFor(selectedAvatar.curriculumId).catch((err: unknown) => setError(humanizeError(err)));
  }, [selectedAvatar, loadCurriculumFor]);

  async function handleCreateCurriculum(): Promise<void> {
    if (!selectedAvatarId || !newCurriculumTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createCurriculum({ avatarId: selectedAvatarId, title: newCurriculumTitle.trim() });
      setNewCurriculumTitle("");
      await refreshAvatars();
      await loadCurriculumFor(created.id);
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveObjectives(): Promise<void> {
    if (!curriculum) return;
    setSaving(true);
    setError(null);
    try {
      const input: ObjectiveInput[] = objectives.map((draft) => ({
        id: draft.id,
        title: draft.title,
        teachingContent: draft.teachingContent,
        checkQuestion: draft.checkQuestion,
        gradingCriteria: draft.gradingCriteria,
      }));
      const result = await replaceCurriculumObjectives(curriculum.id, input);
      setObjectives(
        result.objectives.map((objective) => ({
          key: objective.id,
          id: objective.id,
          title: objective.title,
          teachingContent: objective.teachingContent,
          checkQuestion: objective.checkQuestion,
          gradingCriteria: objective.gradingCriteria,
        })),
      );
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCurriculum(): Promise<void> {
    if (!curriculum) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteCurriculum(curriculum.id);
      setCurriculum(null);
      setObjectives([]);
      setProgress([]);
      await refreshAvatars();
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setDeleting(false);
    }
  }

  if (!avatarsLoaded) return null;

  if (avatars.length === 0) {
    return (
      <p className={styles.empty}>
        No published avatars yet — finish the Avatar Builder for one before authoring a curriculum.
      </p>
    );
  }

  return (
    <div className={styles.body}>
      <div className={styles.avatarPicker}>
        {avatars.map((avatar) => (
          <button
            key={avatar.id}
            type="button"
            className={avatar.id === selectedAvatarId ? styles.avatarChipActive : styles.avatarChip}
            onClick={() => setSelectedAvatarId(avatar.id)}
          >
            {avatar.name}
            {!avatar.curriculumId && <span className={styles.avatarChipHint}>no curriculum</span>}
          </button>
        ))}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {selectedAvatar && !selectedAvatar.curriculumId && (
        <div className={styles.createCard}>
          <p className={styles.createLabel}>{selectedAvatar.name} has no curriculum yet.</p>
          <input
            type="text"
            className={styles.textInput}
            placeholder="Curriculum title, e.g. HR Onboarding"
            value={newCurriculumTitle}
            onChange={(e) => setNewCurriculumTitle(e.target.value)}
          />
          <button
            type="button"
            className={styles.primaryButton}
            disabled={creating || !newCurriculumTitle.trim()}
            onClick={() => void handleCreateCurriculum()}
          >
            {creating ? "Creating…" : "Create Curriculum"}
          </button>
        </div>
      )}

      {curriculum && (
        <>
          <div className={styles.curriculumHeader}>
            <h2 className={styles.curriculumTitle}>{curriculum.title}</h2>
            <button
              type="button"
              className={styles.dangerButton}
              disabled={deleting}
              onClick={() => void handleDeleteCurriculum()}
            >
              {deleting ? "Deleting…" : "Delete Curriculum"}
            </button>
          </div>

          <ObjectiveList objectives={objectives} onChange={setObjectives} />

          <button type="button" className={styles.primaryButton} disabled={saving} onClick={() => void handleSaveObjectives()}>
            {saving ? "Saving…" : "Save Objectives"}
          </button>

          <ProgressTable progress={progress} />
        </>
      )}
    </div>
  );
}
