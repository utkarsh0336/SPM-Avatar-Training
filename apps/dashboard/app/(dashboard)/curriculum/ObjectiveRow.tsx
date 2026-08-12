"use client";

import { TrashIcon } from "../../sessions/icons";
import type { ObjectiveDraft } from "./ObjectiveList";
import styles from "./page.module.css";

export interface ObjectiveRowProps {
  objective: ObjectiveDraft;
  index: number;
  total: number;
  onChange: (patch: Partial<ObjectiveDraft>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

/** Purely presentational — CurriculumEditor owns all objective state, this only renders one row's editable fields. */
export function ObjectiveRow({ objective, index, total, onChange, onRemove, onMoveUp, onMoveDown }: ObjectiveRowProps) {
  return (
    <div className={styles.objectiveRow}>
      <div className={styles.objectiveRowHeader}>
        <span className={styles.objectiveIndex}>{index + 1}</span>
        <input
          type="text"
          className={styles.textInput}
          placeholder="Objective title"
          value={objective.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <div className={styles.objectiveRowActions}>
          <button type="button" className={styles.iconButton} disabled={index === 0} onClick={onMoveUp} aria-label="Move up">
            ↑
          </button>
          <button
            type="button"
            className={styles.iconButton}
            disabled={index === total - 1}
            onClick={onMoveDown}
            aria-label="Move down"
          >
            ↓
          </button>
          <button type="button" className={styles.iconButton} onClick={onRemove} aria-label="Remove objective">
            <TrashIcon size={14} />
          </button>
        </div>
      </div>
      <textarea
        className={styles.textArea}
        placeholder="What should the avatar teach for this objective?"
        value={objective.teachingContent}
        onChange={(e) => onChange({ teachingContent: e.target.value })}
      />
      <input
        type="text"
        className={styles.textInput}
        placeholder="Check question, e.g. How many days of leave do employees get?"
        value={objective.checkQuestion}
        onChange={(e) => onChange({ checkQuestion: e.target.value })}
      />
      <input
        type="text"
        className={styles.textInput}
        placeholder="Grading criteria, e.g. Answer must say 20 days"
        value={objective.gradingCriteria}
        onChange={(e) => onChange({ gradingCriteria: e.target.value })}
      />
    </div>
  );
}
