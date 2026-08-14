import { redirect } from "next/navigation";
import { getMe } from "../../../../lib/server-api";
import { MembersPanel } from "./MembersPanel";
import styles from "../page.module.css";

export const metadata = {
  title: "Avatrain — Members",
};

/**
 * OWNER-only, same gate as settings/page.tsx and settings/embed/page.tsx —
 * inviting members/partners is admin-level. See .claude/specs/partner-role.md,
 * which adds this page: neither POST /v1/auth/invite nor GET
 * /v1/auth/members (.claude/specs/authentication.md) had a dashboard UI
 * before this.
 */
export default async function MembersPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "OWNER") redirect("/");

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>SETTINGS</span>
        <h1 className={styles.title}>Members</h1>
        <p className={styles.subtitle}>
          Invite teammates into {me.org.name} as a Member, or an external partner/distributor as a read-only
          Partner scoped to your partner-enablement curricula.
        </p>
      </div>
      <MembersPanel />
    </div>
  );
}
