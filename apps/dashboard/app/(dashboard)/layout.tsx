import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "../../lib/server-api";
import { LogoutButton } from "./LogoutButton";

/**
 * The authoritative auth gate — middleware.ts only does a fast,
 * presence-only cookie redirect; this GET /v1/auth/me check is the real
 * security boundary. See .claude/specs/authentication.md.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) {
    redirect("/login");
  }

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          borderBottom: "1px solid #e3e5f0",
        }}
      >
        <span style={{ fontWeight: 700, color: "#14162a" }}>{me.org.name}</span>
        <LogoutButton />
      </header>
      <main>{children}</main>
    </div>
  );
}
