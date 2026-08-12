import { redirect } from "next/navigation";
import { getMe } from "../../../lib/server-api";
import { CurriculumEditor } from "./CurriculumEditor";
import styles from "./page.module.css";

export const metadata = {
  title: "Avatrain — Curriculum",
};

/**
 * OWNER-only, same gate as knowledge/page.tsx and settings/page.tsx —
 * content curation is admin-level for now. See
 * .claude/specs/interactive-assessment.md.
 */
export default async function CurriculumPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "OWNER") redirect("/");

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>CURRICULUM</span>
        <h1 className={styles.title}>Interactive Assessment</h1>
        <p className={styles.subtitle}>
          Give an avatar a checkable curriculum: teach each objective, then ask its check
          question. The avatar grades the learner's answer and tracks progress automatically.
        </p>
      </div>
      <CurriculumEditor />
    </div>
  );
}
