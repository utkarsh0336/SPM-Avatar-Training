"use client";

import { useState } from "react";
import { replaceObjectiveScenario } from "../../../lib/api-client";
import { TrashIcon } from "../../sessions/icons";
import type { ObjectiveDraft } from "./ObjectiveList";
import { ScenarioEditor, scenarioDraftsToInput, scenarioResultToDrafts, type ScenarioStepDraft } from "./ScenarioEditor";
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

/**
 * Purely presentational for the flat title/teaching/check-question/grading fields —
 * CurriculumEditor owns that state via onChange, same as every other row here. The branching
 * scenario editor below is the one exception: it's self-contained (its own local draft state,
 * its own PUT /v1/objectives/:id/scenario save call) because it's saved independently of the
 * main objectives list, exactly like ChecklistEditor is independent of it. See
 * .claude/specs/branching-scenario-questions.md's UI Changes.
 */
export function ObjectiveRow({ objective, index, total, onChange, onRemove, onMoveUp, onMoveDown }: ObjectiveRowProps) {
  const [scenarioExpanded, setScenarioExpanded] = useState(false);
  const [scenarioSteps, setScenarioSteps] = useState<ScenarioStepDraft[]>(() =>
    scenarioResultToDrafts(objective.scenarioSteps ?? []),
  );
  const [savingScenario, setSavingScenario] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  async function handleSaveScenario(): Promise<void> {
    if (!objective.id) return;
    setSavingScenario(true);
    setScenarioError(null);
    try {
      const result = await replaceObjectiveScenario(objective.id, scenarioDraftsToInput(scenarioSteps));
      setScenarioSteps(scenarioResultToDrafts(result.steps));
    } catch {
      setScenarioError("Failed to save scenario. Please try again.");
    } finally {
      setSavingScenario(false);
    }
  }

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

      <button
        type="button"
        className={styles.addButton}
        disabled={!objective.id}
        title={objective.id ? undefined : "Save this objective first"}
        onClick={() => setScenarioExpanded((expanded) => !expanded)}
      >
        {scenarioExpanded ? "Hide Branching Scenario" : "Branching Scenario"}
      </button>

      {scenarioExpanded && objective.id && (
        <>
          <ScenarioEditor steps={scenarioSteps} onChange={setScenarioSteps} />
          {scenarioError && <p className={styles.error}>{scenarioError}</p>}
          <button type="button" className={styles.primaryButton} disabled={savingScenario} onClick={() => void handleSaveScenario()}>
            {savingScenario ? "Saving…" : "Save Scenario"}
          </button>
        </>
      )}
    </div>
  );
}
