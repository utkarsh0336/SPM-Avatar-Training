"use client";

import { useCallback, useEffect, useState } from "react";
import { getUsageAnalytics } from "../../../lib/api-client";
import type { UsageAnalyticsResponse } from "@avatrain/shared/analytics";
import styles from "./page.module.css";

const WINDOW_OPTIONS: Array<{ value: 7 | 30 | 90; label: string }> = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

/**
 * Fetch/state orchestrator for GET /v1/analytics/usage, same shape as
 * EffectivenessSummary.tsx — purely presentational aggregate display, no forms. See
 * .claude/specs/dashboard-analytics.md.
 */
export function UsageAnalyticsSummary() {
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<UsageAnalyticsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async (days: 7 | 30 | 90) => {
    setLoaded(false);
    const result = await getUsageAnalytics(days);
    setData(result);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh(windowDays);
  }, [refresh, windowDays]);

  return (
    <div className={styles.analyticsSummary}>
      <div className={styles.windowSwitcher}>
        {WINDOW_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === windowDays ? styles.windowOptionActive : styles.windowOption}
            onClick={() => setWindowDays(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!loaded || !data ? (
        <p className={styles.empty}>Loading…</p>
      ) : (
        <>
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{data.activeUserCount}</span>
              <span className={styles.statLabel}>Active users (dashboard rehearsal)</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{data.totalConversationCount}</span>
              <span className={styles.statLabel}>Total conversations (dashboard rehearsal)</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatDuration(data.avgSessionDurationSeconds)}</span>
              <span className={styles.statLabel}>Avg. session duration</span>
            </div>
          </div>

          <div className={styles.knowledgeAreas}>
            <span className={styles.sectionLabel}>MOST-ACCESSED KNOWLEDGE AREAS</span>
            {data.topKnowledgeAreas.length === 0 ? (
              <p className={styles.empty}>No knowledge retrieval yet in this window.</p>
            ) : (
              <table className={styles.knowledgeTable}>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Category</th>
                    <th>Accesses</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topKnowledgeAreas.map((area) => (
                    <tr key={area.documentId}>
                      <td>{area.documentTitle}</td>
                      <td>{area.category ?? "—"}</td>
                      <td>{area.accessCount}</td>
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
