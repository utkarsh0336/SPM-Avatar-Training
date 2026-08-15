"use client";

import { useCallback, useEffect, useState } from "react";
import { getSatisfactionAnalytics } from "../../../lib/api-client";
import type { SatisfactionAnalyticsResponse } from "@avatrain/shared/analytics";
import styles from "./page.module.css";

const WINDOW_OPTIONS: Array<{ value: 7 | 30 | 90; label: string }> = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

function formatRating(rating: number | null): string {
  if (rating === null) return "—";
  return rating.toFixed(1);
}

/**
 * Fetch/state orchestrator for GET /v1/analytics/satisfaction, same self-contained
 * fetch/window-switcher shape as PerformanceAnalyticsSummary.tsx. See
 * .claude/specs/user-satisfaction.md — every row this reflects today comes from the public
 * apps/widget embed, so like AI Performance above it, this is real, org-wide data.
 */
export function SatisfactionAnalyticsSummary() {
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<SatisfactionAnalyticsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async (days: 7 | 30 | 90) => {
    setLoaded(false);
    const result = await getSatisfactionAnalytics(days);
    setData(result);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh(windowDays);
  }, [refresh, windowDays]);

  const maxCount = data ? Math.max(1, ...data.ratingDistribution.map((point) => point.count)) : 1;

  return (
    <div className={styles.analyticsSummary}>
      <span className={styles.sectionLabel}>USER SATISFACTION (REAL, ORG-WIDE)</span>
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
              <span className={styles.statValue}>{formatRating(data.avgRating)}</span>
              <span className={styles.statLabel}>Avg. rating (out of 5)</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{data.ratingCount}</span>
              <span className={styles.statLabel}>Ratings submitted</span>
            </div>
          </div>

          <div className={styles.ratingDistribution}>
            <span className={styles.sectionLabel}>RATING DISTRIBUTION</span>
            {data.ratingDistribution
              .slice()
              .reverse()
              .map((point) => (
                <div key={point.rating} className={styles.ratingBarRow}>
                  <span className={styles.ratingBarLabel}>{point.rating} ★</span>
                  <div className={styles.ratingBarTrack}>
                    <div
                      className={styles.ratingBarFill}
                      style={{ width: `${(point.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className={styles.ratingBarCount}>{point.count}</span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
