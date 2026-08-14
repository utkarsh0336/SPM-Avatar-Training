"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createCurriculum,
  deleteCurriculum,
  getCurriculum,
  listActiveAvatars,
  listCurricula,
  listCurriculumProgress,
  replaceCurriculumObjectives,
  updateCurriculum,
} from "../../../lib/api-client";
import type {
  AvatarSummary,
  CurriculumResult,
  CurriculumSummary,
  ObjectiveInput,
  ObjectiveProgressEntry,
  ProgramType,
} from "@avatrain/shared/curriculum";
import { ObjectiveList, type ObjectiveDraft } from "./ObjectiveList";
import { ProgressTable } from "./ProgressTable";
import styles from "./page.module.css";

// Human-readable labels for SOW §3.4's four program types — see
// .claude/specs/training-catalog.md. "" (not a ProgramType value) represents
// null/uncategorized in the <select> below.
const PROGRAM_TYPE_OPTIONS: { value: ProgramType | ""; label: string }[] = [
  { value: "", label: "Uncategorized" },
  { value: "EMPLOYEE_ONBOARDING", label: "Employee Onboarding" },
  { value: "COMPLIANCE_TRAINING", label: "Compliance Training" },
  { value: "CUSTOMER_EDUCATION", label: "Customer Education" },
  { value: "PARTNER_ENABLEMENT", label: "Partner Enablement" },
];

function programTypeLabel(programType: ProgramType | null): string {
  return PROGRAM_TYPE_OPTIONS.find((option) => option.value === (programType ?? ""))?.label ?? "Uncategorized";
}

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

export interface CurriculumEditorProps {
  role: "OWNER" | "PARTNER";
}

/**
 * Dispatches on role rather than branching inside one component — a PARTNER
 * must never even attempt OwnerCurriculumEditor's OWNER-only
 * GET /v1/avatars call as a side effect of a shared component's hooks
 * running unconditionally. Each branch is its own component with its own
 * hooks, so React's rules-of-hooks are respected per-component. See
 * .claude/specs/partner-role.md's UI Changes.
 */
export function CurriculumEditor({ role }: CurriculumEditorProps) {
  return role === "PARTNER" ? <PartnerCurriculumView /> : <OwnerCurriculumEditor />;
}

/**
 * Stateful orchestrator, mirroring KnowledgeBase.tsx's shape: owns
 * fetch/save state, delegates rendering to ObjectiveList/ProgressTable. No
 * polling — authoring and viewing progress are on-demand actions here,
 * unlike Knowledge Base's async-ingestion-status screen. See
 * .claude/specs/interactive-assessment.md's UI Changes.
 */
function OwnerCurriculumEditor() {
  const [avatars, setAvatars] = useState<AvatarSummary[]>([]);
  const [avatarsLoaded, setAvatarsLoaded] = useState(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
  const [curriculum, setCurriculum] = useState<CurriculumResult | null>(null);
  const [objectives, setObjectives] = useState<ObjectiveDraft[]>([]);
  const [progress, setProgress] = useState<ObjectiveProgressEntry[]>([]);
  const [newCurriculumTitle, setNewCurriculumTitle] = useState("");
  const [newCurriculumProgramType, setNewCurriculumProgramType] = useState<ProgramType | "">("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingProgramType, setSavingProgramType] = useState(false);
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
      const created = await createCurriculum({
        avatarId: selectedAvatarId,
        title: newCurriculumTitle.trim(),
        ...(newCurriculumProgramType ? { programType: newCurriculumProgramType } : {}),
      });
      setNewCurriculumTitle("");
      setNewCurriculumProgramType("");
      await refreshAvatars();
      await loadCurriculumFor(created.id);
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleChangeProgramType(next: ProgramType | ""): Promise<void> {
    if (!curriculum) return;
    setSavingProgramType(true);
    setError(null);
    try {
      const updated = await updateCurriculum(curriculum.id, { programType: next || null });
      setCurriculum(updated);
      await refreshAvatars();
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setSavingProgramType(false);
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
            {avatar.curriculumId && <span className={styles.avatarChipHint}>{programTypeLabel(avatar.programType)}</span>}
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
          <select
            className={styles.textInput}
            value={newCurriculumProgramType}
            onChange={(e) => setNewCurriculumProgramType(e.target.value as ProgramType | "")}
          >
            {PROGRAM_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
            <select
              className={styles.programTypeSelect}
              value={curriculum.programType ?? ""}
              disabled={savingProgramType}
              onChange={(e) => void handleChangeProgramType(e.target.value as ProgramType | "")}
            >
              {PROGRAM_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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

/**
 * Read-only counterpart to OwnerCurriculumEditor — a PARTNER can browse and
 * inspect progress on the curricula shared with them (already narrowed to
 * PARTNER_ENABLEMENT server-side by listCurricula/getCurriculum, see
 * .claude/specs/partner-role.md), but every authoring control (create,
 * program-type edit, objective add/edit/reorder/remove, delete) is simply
 * absent from this component rather than present-but-disabled.
 */
function PartnerCurriculumView() {
  const [curricula, setCurricula] = useState<CurriculumSummary[]>([]);
  const [curriculaLoaded, setCurriculaLoaded] = useState(false);
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string | null>(null);
  const [curriculum, setCurriculum] = useState<CurriculumResult | null>(null);
  const [progress, setProgress] = useState<ObjectiveProgressEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listCurricula().then((result) => {
      setCurricula(result.curricula);
      setCurriculaLoaded(true);
      if (result.curricula.length > 0) setSelectedCurriculumId((current) => current ?? result.curricula[0]!.id);
    });
  }, []);

  useEffect(() => {
    setError(null);
    if (!selectedCurriculumId) {
      setCurriculum(null);
      setProgress([]);
      return;
    }
    void Promise.all([getCurriculum(selectedCurriculumId), listCurriculumProgress(selectedCurriculumId)])
      .then(([loadedCurriculum, loadedProgress]) => {
        setCurriculum(loadedCurriculum);
        setProgress(loadedProgress.progress);
      })
      .catch((err: unknown) => setError(humanizeError(err)));
  }, [selectedCurriculumId]);

  if (!curriculaLoaded) return null;

  if (curricula.length === 0) {
    return <p className={styles.empty}>No partner-enablement curricula have been shared with you yet.</p>;
  }

  return (
    <div className={styles.body}>
      <div className={styles.avatarPicker}>
        {curricula.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={entry.id === selectedCurriculumId ? styles.avatarChipActive : styles.avatarChip}
            onClick={() => setSelectedCurriculumId(entry.id)}
          >
            {entry.avatarName}
            <span className={styles.avatarChipHint}>{entry.title}</span>
          </button>
        ))}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {curriculum && (
        <>
          <div className={styles.curriculumHeader}>
            <h2 className={styles.curriculumTitle}>{curriculum.title}</h2>
            <span className={styles.avatarChipHint}>{programTypeLabel(curriculum.programType)}</span>
          </div>

          <div className={styles.objectiveList}>
            {curriculum.objectives.length === 0 && <p className={styles.empty}>No objectives yet.</p>}
            {curriculum.objectives.map((objective) => (
              <div key={objective.id} className={styles.objectiveRow}>
                <span className={styles.curriculumTitle}>{objective.title}</span>
                <p className={styles.createLabel}>{objective.teachingContent}</p>
                <p className={styles.createLabel}>
                  <strong>Check:</strong> {objective.checkQuestion}
                </p>
              </div>
            ))}
          </div>

          <ProgressTable progress={progress} />
        </>
      )}
    </div>
  );
}
