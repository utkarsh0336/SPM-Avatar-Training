"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { TrainingSessionResult } from "@avatrain/shared/training-session";
import { getTrainingSession } from "../../../lib/api-client";
import { VideoChatSession } from "./VideoChatSession";
import styles from "../page.module.css";

export default function TrainingSessionPage() {
  const params = useParams<{ trainingSessionId: string }>();
  const [session, setSession] = useState<TrainingSessionResult | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setNotFound(false);
    getTrainingSession(params.trainingSessionId)
      .then((result) => {
        if (!cancelled) setSession(result);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [params.trainingSessionId]);

  if (notFound) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyTitle}>Session not found</span>
        <span>It may have been removed, or the link is out of date.</span>
      </div>
    );
  }

  if (!session) return null;

  return <VideoChatSession session={session} />;
}
