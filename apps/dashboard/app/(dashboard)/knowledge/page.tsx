import { redirect } from "next/navigation";
import { getMe } from "../../../lib/server-api";
import { KnowledgeBase } from "./KnowledgeBase";
import styles from "./page.module.css";

export const metadata = {
  title: "Avatrain — Knowledge Base",
};

/**
 * OWNER-only, same gate as settings/page.tsx — content curation is
 * admin-level for now (see apps/api/src/routes/knowledge.ts's own doc
 * comment). (dashboard)/layout.tsx already redirects an unauthenticated
 * caller to /login before this page renders; the `!me` check here is
 * defensive, not the primary gate.
 */
export default async function KnowledgePage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "OWNER") redirect("/");

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>KNOWLEDGE BASE</span>
        <h1 className={styles.title}>Organization Knowledge</h1>
        <p className={styles.subtitle}>
          Upload SOPs, policies, and reference documents. The AI avatar grounds its answers in
          these first, falling back to general knowledge only when nothing relevant is found.
        </p>
      </div>
      <KnowledgeBase />
    </div>
  );
}
