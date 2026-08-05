"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./NewSessionModal.module.css";
import { useSessions } from "./SessionsContext";

// Not shown in the reference screenshot — some flow state has to select which
// avatar/topic to talk to before a session can start. See
// .claude/specs/video-chat-session.md Implementation Assumptions #5.
const TOPIC_OPTIONS = [
  "HR & Leave Policy",
  "Sales & Negotiation",
  "Compliance & Legal",
  "Product Training",
  "Customer Support",
];

interface NewSessionModalProps {
  onClose: () => void;
}

export function NewSessionModal({ onClose }: NewSessionModalProps) {
  const router = useRouter();
  const { addSession } = useSessions();
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState<string>(TOPIC_OPTIONS[0] ?? "HR & Leave Policy");

  function handleStart() {
    const trimmed = title.trim();
    if (!trimmed) return;
    const created = addSession({ title: trimmed, topic });
    onClose();
    router.push(`/sessions/${created.id}`);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <span className={styles.title}>Start a new video chat</span>

        <label className={styles.field}>
          <span className={styles.label}>Session title</span>
          <input
            className={styles.input}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Sales Pitch Practice"
            autoFocus
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Avatar topic</span>
          <select
            className={styles.select}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          >
            {TOPIC_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.startButton}
            onClick={handleStart}
            disabled={!title.trim()}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
