import type { ReactNode } from "react";
import { OnboardingProvider } from "./OnboardingContext";
import { Sidebar } from "./Sidebar";
import styles from "./layout.module.css";
import tokens from "./tokens.module.css";

export const metadata = {
  title: "Avatar Builder — Onboarding",
};

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${tokens.tokens} ${styles.shell}`}>
      <OnboardingProvider>
        <Sidebar />
        <div className={styles.mainColumn}>{children}</div>
      </OnboardingProvider>
    </div>
  );
}
