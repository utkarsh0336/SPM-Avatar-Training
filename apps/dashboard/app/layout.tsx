import type { ReactNode } from "react";
import "./globals.css";
import { SessionsProvider } from "./sessions/SessionsContext";
import { VoiceSessionsProvider } from "./voice-ai/VoiceSessionsContext";

export const metadata = {
  title: "Avatrain Dashboard",
};

// SessionsProvider is global so both /sessions and /onboarding — separate
// top-level route trees — share one instance and its GET /v1/training-sessions
// fetch. onboarding's VoiceReviewStep needs to call addSession() and
// navigate straight to the new session, not just to the sessions hub.
// VoiceSessionsProvider is global for the same reason: /voice-ai's picker
// (Page 1) calls addSession() and navigates straight into /voice-ai/[id].
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionsProvider>
          <VoiceSessionsProvider>{children}</VoiceSessionsProvider>
        </SessionsProvider>
      </body>
    </html>
  );
}
