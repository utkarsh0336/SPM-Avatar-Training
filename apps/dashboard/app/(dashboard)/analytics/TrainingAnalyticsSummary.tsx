"use client";

import { useCallback, useEffect, useState } from "react";
import { getTrainingAnalytics } from "../../../lib/api-client";
import type { TrainingAnalyticsResponse } from "@avatrain/shared/analytics";
import styles from "./page.module.css";

function formatPercent(rate: number | null): string {
  if (rate === null) return "—";
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
 * Fetch/state orchestrator for GET /v1/analytics/training — same shape as
 * UsageAnalyticsSummary.tsx, minus the window switcher (the endpoint is unwindowed). See
 * .claude/specs/training-analytics.md.
 */
export function TrainingAnalyticsSummary() {
  const [data, setData] = useState<TrainingAnalyticsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setLoaded(false);
    const result = await getTrainingAnalytics();
    setData(result);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className={styles.analyticsSummary}>
      {!loaded || !data ? (
        <p className={styles.empty}>Loading…</p>
      ) : (
        <>
          <span className={styles.sectionLabel}>TRAINING OUTCOMES</span>
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{data.participantCount}</span>
              <span className={styles.statLabel}>Participants (dashboard rehearsal)</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{data.curriculumsWithActivityCount}</span>
              <span className={styles.statLabel}>Curricula with activity</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatPercent(data.avgCompletionRate)}</span>
              <span className={styles.statLabel}>Avg. completion rate</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatDuration(data.avgTimeToCompetencySeconds)}</span>
              <span className={styles.statLabel}>Avg. time to competency</span>
            </div>
          </div>

          <div className={styles.knowledgeAreas}>
            <span className={styles.sectionLabel}>KNOWLEDGE GAPS</span>
            {data.knowledgeGaps.length === 0 ? (
              <p className={styles.empty}>No knowledge gaps identified yet.</p>
            ) : (
              <table className={styles.knowledgeTable}>
                <thead>
                  <tr>
                    <th>Objective</th>
                    <th>Curriculum</th>
                    <th>Pass rate</th>
                    <th>Attempted learners</th>
                  </tr>
                </thead>
                <tbody>
                  {data.knowledgeGaps.map((gap) => (
                    <tr key={gap.objectiveId}>
                      <td>{gap.objectiveTitle}</td>
                      <td>{gap.curriculumTitle}</td>
                      <td>{formatPercent(gap.passRate)}</td>
                      <td>{gap.attemptedLearnerCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
