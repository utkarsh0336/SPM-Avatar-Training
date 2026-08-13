import { redirect } from "next/navigation";
import { getMe } from "../../../lib/server-api";
import { AvatarsManager } from "./AvatarsManager";
import styles from "./page.module.css";

export const metadata = {
  title: "Avatrain — Avatars",
};

/**
 * OWNER-only, same gate as knowledge/page.tsx and settings/page.tsx —
 * persona creation/editing is admin-level, matching this repo's existing
 * convention. Reading a persona to start a session (GET /v1/avatars/mine,
 * GET /v1/avatars/:avatarId) stays open to any org member — only
 * create/edit/publish/archive are OWNER-gated (see routes/avatars.ts).
 */
export default async function AvatarsPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "OWNER") redirect("/");

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>AVATARS</span>
        <h1 className={styles.title}>Avatar Personas</h1>
        <p className={styles.subtitle}>
          Create and manage multiple avatar personas — different departments, languages, or
          training topics can each get their own look, expertise, and voice.
        </p>
      </div>
      <AvatarsManager />
    </div>
  );
}
