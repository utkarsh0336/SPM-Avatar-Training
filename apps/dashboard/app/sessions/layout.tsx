import type { ReactNode } from "react";
import { getMe } from "../../lib/server-api";
import { orgAccentStyle } from "../../lib/org-theme";
import { resolveLocale } from "../../lib/locale/dictionaries";
import { LocaleProvider } from "../../lib/locale/LocaleProvider";
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
//
// getMe() here is for branding data only, not an auth gate — this route
// tree still relies on middleware.ts's cookie-presence redirect the same as
// before this change; a null result (no session, or the call failed) just
// falls back to the product's own default look. See
// .claude/specs/tenant-branding.md.
export default async function SessionsLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  return (
    <div className={`${tokens.tokens} ${styles.shell}`} style={orgAccentStyle(me?.org)}>
      <LocaleProvider initialLocale={resolveLocale(me?.user.uiLocale)}>
        <Sidebar org={me?.org} />
        <SessionListColumn />
        <div className={styles.content}>{children}</div>
      </LocaleProvider>
    </div>
  );
}
