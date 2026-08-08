import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { SessionListColumn } from "./SessionListColumn";
import styles from "./layout.module.css";
import tokens from "./tokens.module.css";

export const metadata = {
  title: "Avatrain — AI Avatar Hub",
};

// SessionsProvider now lives in the root layout, not here — the onboarding
// wizard's "Create Avatar & Start Session" needs to call addSession() and
// navigate straight into the new session, which requires the SAME provider
// instance /sessions/[trainingSessionId]/page.tsx reads from via getById().
// A second, locally-scoped provider here would just create an isolated
// second copy of the in-memory session list that onboarding's session was
// never added to.
export default function SessionsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${tokens.tokens} ${styles.shell}`}>
      <Sidebar />
      <SessionListColumn />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
