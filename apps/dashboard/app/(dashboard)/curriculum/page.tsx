import { redirect } from "next/navigation";
import { getMe } from "../../../lib/server-api";
import { CurriculumEditor } from "./CurriculumEditor";
import styles from "./page.module.css";

export const metadata = {
  title: "Avatrain — Curriculum",
};

/**
 * OWNER or PARTNER, same gate widening as apps/api/src/routes/curriculum.ts's
 * readGate. knowledge/page.tsx and settings/page.tsx stay OWNER-only
 * unchanged — a PARTNER has no reason to reach either. See
 * .claude/specs/interactive-assessment.md (original OWNER-only gate) and
 * .claude/specs/partner-role.md (PARTNER widening + read-only rendering,
 * handled inside CurriculumEditor).
 */
export default async function CurriculumPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "OWNER" && me.role !== "PARTNER") redirect("/");

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>CURRICULUM</span>
        <h1 className={styles.title}>Interactive Assessment</h1>
        <p className={styles.subtitle}>
          {me.role === "PARTNER"
            ? "The partner-enablement curricula shared with you, read-only."
            : "Give an avatar a checkable curriculum: teach each objective, then ask its check " +
              "question. The avatar grades the learner's answer and tracks progress automatically."}
        </p>
      </div>
      <CurriculumEditor role={me.role} />
    </div>
  );
}
