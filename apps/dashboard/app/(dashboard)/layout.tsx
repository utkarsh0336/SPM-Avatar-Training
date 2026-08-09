import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "../../lib/server-api";
import { Sidebar } from "../sessions/Sidebar";
import styles from "../sessions/layout.module.css";
import tokens from "../sessions/tokens.module.css";

/**
 * The authoritative auth gate — middleware.ts only does a fast,
 * presence-only cookie redirect; this GET /v1/auth/me check is the real
 * security boundary. See .claude/specs/authentication.md.
 *
 * Reuses the sessions hub's shell/tokens/Sidebar directly rather than a
 * per-feature copy, same reasoning as voice-ai/layout.tsx — "Dashboard" is a
 * nav item inside this very Sidebar (MAIN group), not an unrelated feature
 * area, so sharing keeps the chrome pixel-identical across hubs.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) {
    redirect("/login");
  }

  return (
    <div className={`${tokens.tokens} ${styles.shell}`}>
      <Sidebar />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
