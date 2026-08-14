"use client";

import type { CurriculumEffectiveness } from "@avatrain/shared/curriculum";
import styles from "./page.module.css";

export interface EffectivenessSummaryProps {
  effectiveness: CurriculumEffectiveness | null;
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

/**
 * Aggregate companion to ProgressTable's raw rows — GET
 * /v1/curricula/:id/effectiveness. The per-objective rows are already
 * sorted by Objective.order server-side; reading pass rate down that list
 * is the "mastery trend" (see .claude/specs/training-effectiveness-measurement.md).
 */
export function EffectivenessSummary({ effectiveness }: EffectivenessSummaryProps) {
  if (!effectiveness || effectiveness.learnerCount === 0) {
    return <p className={styles.empty}>No learners have attempted a checkpoint yet.</p>;
  }

  return (
    <div className={styles.effectivenessSummary}>
      <div className={styles.statRow}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{formatPercent(effectiveness.completionRate)}</span>
          <span className={styles.statLabel}>Completion rate</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {effectiveness.completedLearnerCount}/{effectiveness.learnerCount}
          </span>
          <span className={styles.statLabel}>Learners completed</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{formatDuration(effectiveness.avgTimeToCompetencySeconds)}</span>
          <span className={styles.statLabel}>Avg. time to competency</span>
        </div>
      </div>

      <table className={styles.progressTable}>
        <thead>
          <tr>
            <th>Objective</th>
            <th>Pass rate</th>
            <th>Passed / Attempted</th>
            <th>Avg. attempts</th>
            <th>Avg. time to competency</th>
          </tr>
        </thead>
        <tbody>
          {effectiveness.objectives.map((objective) => (
            <tr key={objective.objectiveId}>
              <td>{objective.objectiveTitle}</td>
              <td>{formatPercent(objective.passRate)}</td>
              <td>
                {objective.passedLearnerCount}/{objective.attemptedLearnerCount}
              </td>
              <td>{objective.avgAttemptsToPass === null ? "—" : objective.avgAttemptsToPass.toFixed(1)}</td>
              <td>{formatDuration(objective.avgTimeToCompetencySeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
