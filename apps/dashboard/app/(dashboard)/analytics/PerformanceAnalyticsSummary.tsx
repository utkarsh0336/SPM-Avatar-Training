"use client";

import { useCallback, useEffect, useState } from "react";
import { getPerformanceAnalytics } from "../../../lib/api-client";
import type { PerformanceAnalyticsResponse } from "@avatrain/shared/analytics";
import styles from "./page.module.css";

const WINDOW_OPTIONS: Array<{ value: 7 | 30 | 90; label: string }> = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  return `${Math.round(ms)}ms`;
}

function formatPercent(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}

/**
 * Fetch/state orchestrator for GET /v1/analytics/performance, same self-contained
 * fetch/window-switcher shape as UsageAnalyticsSummary.tsx. Unlike that section and
 * TrainingAnalyticsSummary, every number here is real, org-wide production data — see
 * .claude/specs/ai-performance-analytics.md.
 */
export function PerformanceAnalyticsSummary() {
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<PerformanceAnalyticsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async (days: 7 | 30 | 90) => {
    setLoaded(false);
    const result = await getPerformanceAnalytics(days);
    setData(result);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh(windowDays);
  }, [refresh, windowDays]);

  return (
    <div className={styles.analyticsSummary}>
      <span className={styles.sectionLabel}>AI PERFORMANCE (REAL, ORG-WIDE)</span>
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
              <span className={styles.statValue}>{data.turnCount}</span>
              <span className={styles.statLabel}>Conversational turns</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatMs(data.avgLatencyMs.total)}</span>
              <span className={styles.statLabel}>Avg. total turn latency</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatMs(data.avgLatencyMs.stt)}</span>
              <span className={styles.statLabel}>Avg. speech-to-text</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatMs(data.avgLatencyMs.retrieval)}</span>
              <span className={styles.statLabel}>Avg. knowledge retrieval</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatMs(data.avgLatencyMs.llmFirstToken)}</span>
              <span className={styles.statLabel}>Avg. LLM first token</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatMs(data.avgLatencyMs.ttsFirstChunk)}</span>
              <span className={styles.statLabel}>Avg. TTS first chunk</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatPercent(data.groundedReplyRate)}</span>
              <span className={styles.statLabel}>Grounded-reply rate (not accuracy — see below)</span>
            </div>
          </div>

          <div className={styles.knowledgeAreas}>
            <span className={styles.sectionLabel}>KNOWLEDGE UTILIZATION — LAST 14 DAYS</span>
            <table className={styles.knowledgeTable}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Knowledge accesses</th>
                </tr>
              </thead>
              <tbody>
                {data.knowledgeUtilizationTrend.map((point) => (
                  <tr key={point.date}>
                    <td>{point.date}</td>
                    <td>{point.accessCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
