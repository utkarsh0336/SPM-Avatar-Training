"use client";

import { useParams } from "next/navigation";
import { useSessions } from "../SessionsContext";
import { VideoChatSession } from "./VideoChatSession";
import styles from "../page.module.css";

export default function TrainingSessionPage() {
  const params = useParams<{ trainingSessionId: string }>();
  const { getById } = useSessions();
  const session = getById(params.trainingSessionId);

  if (!session) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyTitle}>Session not found</span>
        <span>It may have been removed, or the link is out of date.</span>
      </div>
    );
  }

  return <VideoChatSession session={session} />;
}
