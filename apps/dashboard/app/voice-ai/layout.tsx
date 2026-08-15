import type { ReactNode } from "react";
import { getMe } from "../../lib/server-api";
import { orgAccentStyle } from "../../lib/org-theme";
import { resolveLocale } from "../../lib/locale/dictionaries";
import { LocaleProvider } from "../../lib/locale/LocaleProvider";
import { Sidebar } from "../sessions/Sidebar";
import styles from "../sessions/layout.module.css";
import tokens from "../sessions/tokens.module.css";

export const metadata = {
  title: "Avatrain — Voice AI",
};

// Reuses the sessions hub's shell/tokens/Sidebar directly rather than a
// per-feature copy — Voice AI is a sibling item inside the very same "AI
// Avatar Hub" nav group as New Chat (see Sidebar.tsx), not an unrelated
// feature area, so sharing guarantees the pixel-identical chrome the design
// requires instead of two copies drifting apart. Unlike /sessions, the
// history column only appears on the live-session route ([voiceSessionId]),
// not on the picker (page.tsx) — so it isn't rendered here in the layout.
//
// getMe() here is for branding data only, not an auth gate — same reasoning
// as sessions/layout.tsx. See .claude/specs/tenant-branding.md.
export default async function VoiceAiLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  return (
    <div className={`${tokens.tokens} ${styles.shell}`} style={orgAccentStyle(me?.org)}>
      <LocaleProvider initialLocale={resolveLocale(me?.user.uiLocale)}>
        <Sidebar org={me?.org} role={me?.role} />
        <div className={styles.content}>{children}</div>
      </LocaleProvider>
    </div>
  );
}
