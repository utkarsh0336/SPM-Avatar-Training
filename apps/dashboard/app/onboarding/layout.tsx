import type { ReactNode } from "react";
import { getMe } from "../../lib/server-api";
import { orgAccentStyle } from "../../lib/org-theme";
import { OnboardingProvider } from "./OnboardingContext";
import { Sidebar } from "./Sidebar";
import styles from "./layout.module.css";
import tokens from "./tokens.module.css";

export const metadata = {
  title: "Avatar Builder — Onboarding",
};

// getMe() here is for branding data only, not an auth gate — same reasoning
// as sessions/layout.tsx. See .claude/specs/tenant-branding.md.
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  return (
    <div className={`${tokens.tokens} ${styles.shell}`} style={orgAccentStyle(me?.org)}>
      <OnboardingProvider>
        <Sidebar org={me?.org} />
        <div className={styles.mainColumn}>{children}</div>
      </OnboardingProvider>
    </div>
  );
}
