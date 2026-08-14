import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "../../../lib/server-api";
import { getTranslator, resolveLocale } from "../../../lib/locale/dictionaries";
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

  const t = getTranslator(resolveLocale(me.user.uiLocale));

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>{t("settingsPage.eyebrow")}</span>
        <h1 className={styles.title}>{t("settingsPage.title")}</h1>
        <p className={styles.subtitle}>{t("settingsPage.subtitle", { orgName: me.org.name })}</p>
      </div>
      <BrandingForm initialOrg={me.org} />

      <div className={styles.form}>
        <span className={styles.label}>{t("settingsPage.embedLabel")}</span>
        <p className={styles.subtitle}>{t("settingsPage.embedSubtitle", { orgName: me.org.name })}</p>
        <Link href="/settings/embed" className={styles.submit}>
          {t("settingsPage.manageEmbeds")}
        </Link>
      </div>

      <div className={styles.form}>
        <span className={styles.label}>{t("settingsPage.membersLabel")}</span>
        <p className={styles.subtitle}>{t("settingsPage.membersSubtitle")}</p>
        <Link href="/settings/members" className={styles.submit}>
          {t("settingsPage.manageMembers")}
        </Link>
      </div>
    </div>
  );
}
