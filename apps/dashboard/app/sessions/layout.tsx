import type { ReactNode } from "react";
import { SessionsProvider } from "./SessionsContext";
import { Sidebar } from "./Sidebar";
import { SessionListColumn } from "./SessionListColumn";
import styles from "./layout.module.css";
import tokens from "./tokens.module.css";

export const metadata = {
  title: "Avatrain — AI Avatar Hub",
};

export default function SessionsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${tokens.tokens} ${styles.shell}`}>
      <SessionsProvider>
        <Sidebar />
        <SessionListColumn />
        <div className={styles.content}>{children}</div>
      </SessionsProvider>
    </div>
  );
}
