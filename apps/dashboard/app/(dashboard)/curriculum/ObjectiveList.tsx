"use client";

import type { ScenarioStepResult } from "@avatrain/shared/curriculum";
import { PlusIcon } from "../../sessions/icons";
import { ObjectiveRow } from "./ObjectiveRow";
import styles from "./page.module.css";

export interface ObjectiveDraft {
  /** React key — the objective's real id once saved, or a client-generated id for a new, unsaved row. */
  key: string;
  /** Present only for an objective that already exists server-side; absent means "create" on save. */
  id?: string;
  title: string;
  teachingContent: string;
  checkQuestion: string;
  gradingCriteria: string;
  /**
   * As last loaded from the server — undefined for a brand-new, unsaved row. Not touched by this
   * list's own save (PUT .../objectives); ObjectiveRow saves it independently via
   * PUT /v1/objectives/:id/scenario. See .claude/specs/branching-scenario-questions.md.
   */
  scenarioSteps?: ScenarioStepResult[];
}

export interface ObjectiveListProps {
  objectives: ObjectiveDraft[];
  onChange: (objectives: ObjectiveDraft[]) => void;
}

function emptyDraft(): ObjectiveDraft {
  return { key: crypto.randomUUID(), title: "", teachingContent: "", checkQuestion: "", gradingCriteria: "" };
}

/**
 * Local, in-memory ordered-list editor — CurriculumEditor's
 * handleSaveObjectives sends the whole array in one PUT
 * (replace-the-whole-list semantics; see
 * .claude/specs/interactive-assessment.md's API Changes). Array position
 * here is what becomes each objective's `order` on save.
 */
export function ObjectiveList({ objectives, onChange }: ObjectiveListProps) {
  function updateAt(index: number, patch: Partial<ObjectiveDraft>): void {
    onChange(objectives.map((objective, i) => (i === index ? { ...objective, ...patch } : objective)));
  }

  function removeAt(index: number): void {
    onChange(objectives.filter((_, i) => i !== index));
  }

  function swap(a: number, b: number): void {
    const next = [...objectives];
    const temp = next[a]!;
    next[a] = next[b]!;
    next[b] = temp;
    onChange(next);
  }

  return (
    <div className={styles.objectiveList}>
      {objectives.length === 0 && <p className={styles.empty}>No objectives yet — add one below.</p>}
      {objectives.map((objective, index) => (
        <ObjectiveRow
          key={objective.key}
          objective={objective}
          index={index}
          total={objectives.length}
          onChange={(patch) => updateAt(index, patch)}
          onRemove={() => removeAt(index)}
          onMoveUp={() => swap(index, index - 1)}
          onMoveDown={() => swap(index, index + 1)}
        />
      ))}
      <button type="button" className={styles.addButton} onClick={() => onChange([...objectives, emptyDraft()])}>
        <PlusIcon size={16} /> Add Objective
      </button>
    </div>
  );
}
