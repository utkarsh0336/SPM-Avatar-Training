import { redirect } from "next/navigation";
import { getMe } from "../../../../lib/server-api";
import { EmbedSettings } from "./EmbedSettings";
import styles from "../page.module.css";

export const metadata = {
  title: "Avatrain — Embed Settings",
};

/** OWNER-only, same gate as settings/page.tsx. */
export default async function EmbedSettingsPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "OWNER") redirect("/");

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>SETTINGS</span>
        <h1 className={styles.title}>Embed on Any Website</h1>
        <p className={styles.subtitle}>
          Create a publishable key for each site you want to run {me.org.name}&rsquo;s AI avatar on, pin which
          persona it uses, and allowlist the exact origins that may load it.
        </p>
      </div>
      <EmbedSettings />
    </div>
  );
}
