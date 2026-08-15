import { redirect } from "next/navigation";
import { getMe } from "../../../lib/server-api";
import { UsageAnalyticsSummary } from "./UsageAnalyticsSummary";
import { TrainingAnalyticsSummary } from "./TrainingAnalyticsSummary";
import { PerformanceAnalyticsSummary } from "./PerformanceAnalyticsSummary";
import styles from "./page.module.css";

export const metadata = {
  title: "Avatrain — Analytics",
};

/**
 * OWNER-only, same gate as settings/page.tsx and settings/members/page.tsx — org-wide usage
 * numbers are business-sensitive the same way branding/membership are. See
 * .claude/specs/dashboard-analytics.md.
 */
export default async function AnalyticsPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "OWNER") redirect("/");

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>ANALYTICS</span>
        <h1 className={styles.title}>Usage Analytics</h1>
        <p className={styles.subtitle}>
          Active users, conversations, and session duration reflect dashboard rehearsal activity in{" "}
          {me.org.name} — trainers testing their own avatars, not learners on your embedded widget. Knowledge
          area access reflects real usage across both. Participant counts, completion rates, and knowledge
          gaps below reflect the same dashboard rehearsal activity, not real end-learners. AI Performance,
          further below, is different: turn latency, grounded-reply rate, and knowledge-utilization trend are
          all real, org-wide numbers from both your embedded widget and dashboard rehearsal — but
          &quot;grounded-reply rate&quot; measures whether a reply cited your uploaded material, not whether it
          was factually correct, and user-satisfaction data isn&apos;t available yet.
        </p>
      </div>
      <UsageAnalyticsSummary />
      <TrainingAnalyticsSummary />
      <PerformanceAnalyticsSummary />
    </div>
  );
}
