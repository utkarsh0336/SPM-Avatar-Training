import type { ReactNode } from "react";
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
export default function VoiceAiLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${tokens.tokens} ${styles.shell}`}>
      <Sidebar />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
