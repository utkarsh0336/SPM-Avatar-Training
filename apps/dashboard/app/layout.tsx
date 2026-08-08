import type { ReactNode } from "react";
import "./globals.css";
import { SessionsProvider } from "./sessions/SessionsContext";

export const metadata = {
  title: "Avatrain Dashboard",
};

// SessionsProvider is global (in-memory state only, no side effects) so
// both /sessions and /onboarding — separate top-level route trees — share
// one instance. onboarding's VoiceReviewStep needs to call addSession() and
// navigate straight to the new session, not just to the sessions hub.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionsProvider>{children}</SessionsProvider>
      </body>
    </html>
  );
}
