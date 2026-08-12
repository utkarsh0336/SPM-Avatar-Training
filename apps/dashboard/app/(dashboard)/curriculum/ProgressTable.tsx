"use client";

import type { ObjectiveProgressEntry } from "@avatrain/shared/curriculum";
import styles from "./page.module.css";

export interface ProgressTableProps {
  progress: ObjectiveProgressEntry[];
}

/** Purely presentational read-only results view — GET /v1/curricula/:id/progress. */
export function ProgressTable({ progress }: ProgressTableProps) {
  if (progress.length === 0) {
    return <p className={styles.empty}>No learners have attempted a checkpoint yet.</p>;
  }

  return (
    <table className={styles.progressTable}>
      <thead>
        <tr>
          <th>Learner</th>
          <th>Objective</th>
          <th>Verdict</th>
          <th>Attempts</th>
          <th>Feedback</th>
        </tr>
      </thead>
      <tbody>
        {progress.map((entry) => (
          <tr key={`${entry.objectiveId}-${entry.learnerId}`}>
            <td>{entry.learnerEmail}</td>
            <td>{entry.objectiveTitle}</td>
            <td>
              <span className={entry.verdict === "PASS" ? styles.verdictPass : styles.verdictRetry}>
                {entry.verdict}
              </span>
            </td>
            <td>{entry.attempts}</td>
            <td>{entry.feedback}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
