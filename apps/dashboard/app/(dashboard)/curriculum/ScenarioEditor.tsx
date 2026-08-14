"use client";

import type { ScenarioStepInput, ScenarioStepResult } from "@avatrain/shared/curriculum";
import { PlusIcon, TrashIcon } from "../../sessions/icons";
import styles from "./page.module.css";

export interface ScenarioBranchDraft {
  /** React key — stable across reorders, used to resolve "leads to" targets at save time. */
  key: string;
  matchCriteria: string;
  /** "" (unset), "outcome:PASS", "outcome:RETRY", or "step:<other branch's step key>". */
  target: string;
}

export interface ScenarioStepDraft {
  /** React key — the step's real id once saved, or a client-generated id for a new, unsaved row. */
  key: string;
  prompt: string;
  branches: ScenarioBranchDraft[];
}

export interface ScenarioEditorProps {
  steps: ScenarioStepDraft[];
  onChange: (steps: ScenarioStepDraft[]) => void;
}

function emptyBranch(): ScenarioBranchDraft {
  return { key: crypto.randomUUID(), matchCriteria: "", target: "" };
}

function emptyStep(): ScenarioStepDraft {
  return { key: crypto.randomUUID(), prompt: "", branches: [emptyBranch()] };
}

/**
 * Server -> draft. A saved step's key IS its real id, so a branch's
 * `nextStepId` already matches the target step's key one-for-one — no
 * lookup table needed on this direction.
 */
export function scenarioResultToDrafts(steps: ScenarioStepResult[]): ScenarioStepDraft[] {
  return steps.map((step) => ({
    key: step.id,
    prompt: step.prompt,
    branches: step.branches.map((branch) => ({
      key: branch.id,
      matchCriteria: branch.matchCriteria,
      target: branch.nextStepId ? `step:${branch.nextStepId}` : branch.outcome ? `outcome:${branch.outcome}` : "",
    })),
  }));
}

/**
 * Draft -> PUT /v1/objectives/:id/scenario request body. Array position
 * becomes each step's/branch's `order`; a branch's "step:<key>" target is
 * resolved to that step's array index (nextStepOrder) via this save's own
 * key->order map, not a real id — new, not-yet-saved steps don't have one
 * yet. See .claude/specs/branching-scenario-questions.md's API Changes.
 */
export function scenarioDraftsToInput(steps: ScenarioStepDraft[]): ScenarioStepInput[] {
  const keyToOrder = new Map(steps.map((step, index) => [step.key, index]));
  return steps.map((step, stepIndex) => ({
    order: stepIndex,
    prompt: step.prompt,
    branches: step.branches.map((branch, branchIndex) => {
      if (branch.target.startsWith("step:")) {
        const nextStepOrder = keyToOrder.get(branch.target.slice("step:".length)) ?? null;
        return { order: branchIndex, matchCriteria: branch.matchCriteria, nextStepOrder, outcome: null };
      }
      if (branch.target === "outcome:PASS" || branch.target === "outcome:RETRY") {
        const outcome = branch.target.slice("outcome:".length) as "PASS" | "RETRY";
        return { order: branchIndex, matchCriteria: branch.matchCriteria, nextStepOrder: null, outcome };
      }
      // No target chosen yet — default to RETRY rather than send an invalid payload
      // (the server rejects a branch with neither nextStepOrder nor outcome set).
      return { order: branchIndex, matchCriteria: branch.matchCriteria, nextStepOrder: null, outcome: "RETRY" as const };
    }),
  }));
}

/**
 * Local, in-memory editor for one Objective's optional branching scenario — mirrors
 * ChecklistEditor.tsx's add/reorder/remove-then-save-the-whole-list shape, nested one level
 * deeper (steps containing branches). CurriculumEditor.tsx owns the save call (PUT
 * /v1/objectives/:objectiveId/scenario) and the draft->request conversion, same division of
 * responsibility ChecklistEditor already uses. See
 * .claude/specs/branching-scenario-questions.md's UI Changes.
 */
export function ScenarioEditor({ steps, onChange }: ScenarioEditorProps) {
  function updateStepAt(index: number, patch: Partial<ScenarioStepDraft>): void {
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function removeStepAt(index: number): void {
    onChange(steps.filter((_, i) => i !== index));
  }

  function swapSteps(a: number, b: number): void {
    const next = [...steps];
    const temp = next[a]!;
    next[a] = next[b]!;
    next[b] = temp;
    onChange(next);
  }

  function updateBranchAt(stepIndex: number, branchIndex: number, patch: Partial<ScenarioBranchDraft>): void {
    const step = steps[stepIndex]!;
    const branches = step.branches.map((branch, i) => (i === branchIndex ? { ...branch, ...patch } : branch));
    updateStepAt(stepIndex, { branches });
  }

  function removeBranchAt(stepIndex: number, branchIndex: number): void {
    const step = steps[stepIndex]!;
    updateStepAt(stepIndex, { branches: step.branches.filter((_, i) => i !== branchIndex) });
  }

  return (
    <div className={styles.objectiveList}>
      {steps.length === 0 && <p className={styles.empty}>No scenario steps yet — add one below.</p>}
      {steps.map((step, stepIndex) => (
        <div key={step.key} className={styles.objectiveRow}>
          <div className={styles.objectiveRowHeader}>
            <span className={styles.objectiveIndex}>{stepIndex + 1}</span>
            <input
              type="text"
              className={styles.textInput}
              placeholder="What does the avatar present at this step?"
              value={step.prompt}
              onChange={(e) => updateStepAt(stepIndex, { prompt: e.target.value })}
            />
            <div className={styles.objectiveRowActions}>
              <button
                type="button"
                className={styles.iconButton}
                disabled={stepIndex === 0}
                onClick={() => swapSteps(stepIndex, stepIndex - 1)}
                aria-label="Move step up"
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.iconButton}
                disabled={stepIndex === steps.length - 1}
                onClick={() => swapSteps(stepIndex, stepIndex + 1)}
                aria-label="Move step down"
              >
                ↓
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => removeStepAt(stepIndex)}
                aria-label="Remove step"
              >
                <TrashIcon size={14} />
              </button>
            </div>
          </div>

          {step.branches.map((branch, branchIndex) => (
            <div key={branch.key} className={styles.objectiveRowHeader}>
              <input
                type="text"
                className={styles.textInput}
                placeholder="If the learner's answer... (e.g. Apologizes and offers a resolution)"
                value={branch.matchCriteria}
                onChange={(e) => updateBranchAt(stepIndex, branchIndex, { matchCriteria: e.target.value })}
              />
              <select
                className={styles.programTypeSelect}
                value={branch.target}
                onChange={(e) => updateBranchAt(stepIndex, branchIndex, { target: e.target.value })}
              >
                <option value="">leads to…</option>
                <option value="outcome:PASS">End: PASS</option>
                <option value="outcome:RETRY">End: RETRY</option>
                {steps.map((otherStep, otherIndex) => (
                  <option key={otherStep.key} value={`step:${otherStep.key}`}>
                    Continue to Step {otherIndex + 1}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.iconButton}
                disabled={step.branches.length === 1}
                onClick={() => removeBranchAt(stepIndex, branchIndex)}
                aria-label="Remove branch"
              >
                <TrashIcon size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.addButton}
            onClick={() => updateStepAt(stepIndex, { branches: [...step.branches, emptyBranch()] })}
          >
            <PlusIcon size={16} /> Add Branch
          </button>
        </div>
      ))}
      <button type="button" className={styles.addButton} onClick={() => onChange([...steps, emptyStep()])}>
        <PlusIcon size={16} /> Add Step
      </button>
    </div>
  );
}
