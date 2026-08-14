"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createChecklist,
  createCurriculum,
  deleteChecklist,
  deleteCurriculum,
  getChecklist,
  getCurriculum,
  getCurriculumEffectiveness,
  listActiveAvatars,
  listCurricula,
  listCurriculumProgress,
  replaceChecklistItems,
  replaceCurriculumObjectives,
  updateCurriculum,
} from "../../../lib/api-client";
import type {
  AvatarSummary,
  ChecklistItemInput,
  ChecklistResult,
  CurriculumEffectiveness,
  CurriculumResult,
  CurriculumSummary,
  ObjectiveInput,
  ObjectiveProgressEntry,
  ProgramType,
} from "@avatrain/shared/curriculum";
import { ObjectiveList, type ObjectiveDraft } from "./ObjectiveList";
import { ChecklistEditor, type ChecklistItemDraft } from "./ChecklistEditor";
import { EffectivenessSummary } from "./EffectivenessSummary";
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
    scenarioSteps: objective.scenarioSteps,
  }));
}

function toChecklistDrafts(checklist: ChecklistResult): ChecklistItemDraft[] {
  return checklist.items.map((item) => ({
    key: item.id,
    id: item.id,
    title: item.title,
    description: item.description ?? "",
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
  const [effectiveness, setEffectiveness] = useState<CurriculumEffectiveness | null>(null);
  const [checklist, setChecklist] = useState<ChecklistResult | null>(null);
  const [checklistItems, setChecklistItems] = useState<ChecklistItemDraft[]>([]);
  const [newCurriculumTitle, setNewCurriculumTitle] = useState("");
  const [newCurriculumProgramType, setNewCurriculumProgramType] = useState<ProgramType | "">("");
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingProgramType, setSavingProgramType] = useState(false);
  const [savingAdaptiveOrdering, setSavingAdaptiveOrdering] = useState(false);
  const [creatingChecklist, setCreatingChecklist] = useState(false);
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [deletingChecklist, setDeletingChecklist] = useState(false);
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
    const [loadedCurriculum, loadedProgress, loadedEffectiveness, loadedChecklist] = await Promise.all([
      getCurriculum(curriculumId),
      listCurriculumProgress(curriculumId),
      getCurriculumEffectiveness(curriculumId),
      getChecklist(curriculumId),
    ]);
    setCurriculum(loadedCurriculum);
    setObjectives(toDrafts(loadedCurriculum));
    setProgress(loadedProgress.progress);
    setEffectiveness(loadedEffectiveness);
    setChecklist(loadedChecklist);
    setChecklistItems(loadedChecklist ? toChecklistDrafts(loadedChecklist) : []);
  }, []);

  useEffect(() => {
    setError(null);
    if (!selectedAvatar) {
      setCurriculum(null);
      setObjectives([]);
      setProgress([]);
      setEffectiveness(null);
      setChecklist(null);
      setChecklistItems([]);
      return;
    }
    if (!selectedAvatar.curriculumId) {
      setCurriculum(null);
      setObjectives([]);
      setProgress([]);
      setEffectiveness(null);
      setChecklist(null);
      setChecklistItems([]);
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

  async function handleChangeAdaptiveOrdering(next: boolean): Promise<void> {
    if (!curriculum) return;
    setSavingAdaptiveOrdering(true);
    setError(null);
    try {
      const updated = await updateCurriculum(curriculum.id, { adaptiveOrderingEnabled: next });
      setCurriculum(updated);
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setSavingAdaptiveOrdering(false);
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

  async function handleCreateChecklist(): Promise<void> {
    if (!curriculum || !newChecklistTitle.trim()) return;
    setCreatingChecklist(true);
    setError(null);
    try {
      const created = await createChecklist(curriculum.id, newChecklistTitle.trim());
      setNewChecklistTitle("");
      setChecklist({ id: created.id, curriculumId: created.curriculumId, title: created.title, items: [], createdAt: "", updatedAt: "" });
      setChecklistItems([]);
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setCreatingChecklist(false);
    }
  }

  async function handleSaveChecklistItems(): Promise<void> {
    if (!curriculum) return;
    setSavingChecklist(true);
    setError(null);
    try {
      const input: ChecklistItemInput[] = checklistItems.map((draft) => ({
        id: draft.id,
        title: draft.title,
        description: draft.description.trim() ? draft.description : undefined,
      }));
      const result = await replaceChecklistItems(curriculum.id, input);
      setChecklistItems(
        result.items.map((item) => ({ key: item.id, id: item.id, title: item.title, description: item.description ?? "" })),
      );
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setSavingChecklist(false);
    }
  }

  async function handleDeleteChecklist(): Promise<void> {
    if (!curriculum) return;
    setDeletingChecklist(true);
    setError(null);
    try {
      await deleteChecklist(curriculum.id);
      setChecklist(null);
      setChecklistItems([]);
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setDeletingChecklist(false);
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

          <div className={styles.adaptiveOrderingRow}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={curriculum.adaptiveOrderingEnabled}
                disabled={savingAdaptiveOrdering}
                onChange={(e) => void handleChangeAdaptiveOrdering(e.target.checked)}
              />
              Adaptive ordering
            </label>
            <p className={styles.helperText}>
              Reorders objectives per learner — needs-review first, then unattempted, then already
              mastered. Only enable if these objectives don&apos;t depend on being taught in a strict
              sequence.
            </p>
          </div>

          <ObjectiveList objectives={objectives} onChange={setObjectives} />

          <button type="button" className={styles.primaryButton} disabled={saving} onClick={() => void handleSaveObjectives()}>
            {saving ? "Saving…" : "Save Objectives"}
          </button>

          {!checklist && (
            <div className={styles.createCard}>
              <p className={styles.createLabel}>This curriculum has no induction checklist yet.</p>
              <input
                type="text"
                className={styles.textInput}
                placeholder="Checklist title, e.g. Day One Induction"
                value={newChecklistTitle}
                onChange={(e) => setNewChecklistTitle(e.target.value)}
              />
              <button
                type="button"
                className={styles.primaryButton}
                disabled={creatingChecklist || !newChecklistTitle.trim()}
                onClick={() => void handleCreateChecklist()}
              >
                {creatingChecklist ? "Creating…" : "Create Checklist"}
              </button>
            </div>
          )}

          {checklist && (
            <>
              <div className={styles.curriculumHeader}>
                <h2 className={styles.curriculumTitle}>{checklist.title}</h2>
                <button
                  type="button"
                  className={styles.dangerButton}
                  disabled={deletingChecklist}
                  onClick={() => void handleDeleteChecklist()}
                >
                  {deletingChecklist ? "Deleting…" : "Delete Checklist"}
                </button>
              </div>

              <ChecklistEditor items={checklistItems} onChange={setChecklistItems} />

              <button
                type="button"
                className={styles.primaryButton}
                disabled={savingChecklist}
                onClick={() => void handleSaveChecklistItems()}
              >
                {savingChecklist ? "Saving…" : "Save Checklist Items"}
              </button>
            </>
          )}

          <EffectivenessSummary effectiveness={effectiveness} />
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
  const [effectiveness, setEffectiveness] = useState<CurriculumEffectiveness | null>(null);
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
      setEffectiveness(null);
      return;
    }
    void Promise.all([
      getCurriculum(selectedCurriculumId),
      listCurriculumProgress(selectedCurriculumId),
      getCurriculumEffectiveness(selectedCurriculumId),
    ])
      .then(([loadedCurriculum, loadedProgress, loadedEffectiveness]) => {
        setCurriculum(loadedCurriculum);
        setProgress(loadedProgress.progress);
        setEffectiveness(loadedEffectiveness);
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

          <EffectivenessSummary effectiveness={effectiveness} />
          <ProgressTable progress={progress} />
        </>
      )}
    </div>
  );
}
