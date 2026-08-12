import { redirect } from "next/navigation";
import { getMe } from "../../../lib/server-api";
import { BrandingForm } from "./BrandingForm";
import styles from "./page.module.css";

export const metadata = {
  title: "Avatrain — Settings",
};

/**
 * OWNER-only. (dashboard)/layout.tsx already redirects an unauthenticated
 * caller to /login before this page renders — the `!me` check here is
 * defensive, not the primary gate. The role check is this page's own: a
 * MEMBER is redirected to "/" rather than shown a dedicated 403 page, since
 * branding isn't a role a MEMBER will ever have reason to reach. See
 * .claude/specs/tenant-branding.md.
 */
export default async function SettingsPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "OWNER") redirect("/");

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>SETTINGS</span>
        <h1 className={styles.title}>Organization Branding</h1>
        <p className={styles.subtitle}>
          Customize how {me.org.name} looks across the AI Avatar workspace.
        </p>
      </div>
      <BrandingForm initialOrg={me.org} />
    </div>
  );
}
