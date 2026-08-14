"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AvatarRecommendationTier, RecommendedAvatar } from "@avatrain/shared/curriculum";
import styles from "./NewSessionModal.module.css";
import { useSessions } from "./SessionsContext";
import { getRecommendedAvatars } from "../../lib/api-client";

// Suffix appended to each Persona <option>'s label — mirrors the existing " (draft)" suffix
// convention below. NOT_STARTED and NO_CURRICULUM stay unmarked: NOT_STARTED is the unmarked
// default framing for "nothing to report yet", and NO_CURRICULUM (a Q&A-only persona with no
// objectives) has no progress to summarize at all. See
// .claude/specs/personalized-recommendation-engine.md.
const TIER_LABEL: Partial<Record<AvatarRecommendationTier, string>> = {
  NEEDS_REVIEW: " — Needs review",
  IN_PROGRESS: " — Continue",
  COMPLETED: " — Completed",
};

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
  const [avatars, setAvatars] = useState<RecommendedAvatar[]>([]);
  const [avatarId, setAvatarId] = useState<string>("");

  // Ranked for the calling learner (see getRecommendedAvatars) — the picker below defaults to the
  // top-ranked (most personally relevant) avatar, not just the first one returned. Only fetched to
  // decide whether the picker is even worth showing — an org with a single avatar visible to this
  // caller (the common case pre-multi-persona) sees no behavior change at all, matching this
  // feature's own original design intent. Every avatar returned is already ACTIVE-filtered
  // server-side.
  useEffect(() => {
    let cancelled = false;
    getRecommendedAvatars()
      .then((result) => {
        if (cancelled) return;
        setAvatars(result.avatars);
        setAvatarId(result.avatars[0]?.id ?? "");
      })
      .catch(() => {
        // No hard failure — the picker just stays hidden and
        // useConversationSession.ts falls back to its own default persona.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleStart() {
    const trimmed = title.trim();
    if (!trimmed) return;
    const created = addSession({ title: trimmed, topic, avatarId: avatarId || null });
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

        {avatars.length > 1 && (
          <label className={styles.field}>
            <span className={styles.label}>Persona</span>
            <select className={styles.select} value={avatarId} onChange={(event) => setAvatarId(event.target.value)}>
              {avatars.map((avatar) => (
                <option key={avatar.id} value={avatar.id}>
                  {avatar.name}
                  {TIER_LABEL[avatar.recommendationTier] ?? ""}
                </option>
              ))}
            </select>
          </label>
        )}

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
