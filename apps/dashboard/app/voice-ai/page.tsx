"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Language } from "@avatrain/shared/tutor";
import styles from "./page.module.css";
import { ExpertCard } from "./ExpertCard";
import { useVoiceSessions } from "./VoiceSessionsContext";
import { SELECTABLE_VOICE_EXPERTS } from "../../lib/fixtures/voice-experts";
import { MicIcon, PlayIcon, ChevronRightIcon, WandIcon } from "../sessions/icons";

const LANGUAGE_OPTIONS: Language[] = ["English", "Hindi", "Spanish"];

// "Start a Voice Session" — the AI-expert + language picker shown before a
// live voice session begins. 3 experts (Male/Female/Neutral), not the
// reference screenshot's 5, per the feature request.
export default function VoiceAiPage() {
  const router = useRouter();
  const { addSession } = useVoiceSessions();
  const [selectedExpertId, setSelectedExpertId] = useState(SELECTABLE_VOICE_EXPERTS[0]!.id);
  const [language, setLanguage] = useState(LANGUAGE_OPTIONS[0]!);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedExpert =
    SELECTABLE_VOICE_EXPERTS.find((expert) => expert.id === selectedExpertId) ?? SELECTABLE_VOICE_EXPERTS[0]!;

  async function handleStart() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await addSession({ expertId: selectedExpert.id });
      router.push(`/voice-ai/${created.id}?language=${encodeURIComponent(language)}`);
    } catch {
      setError("Could not start the session. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.heroIcon}>
          <MicIcon size={26} />
        </div>
        <h1 className={styles.title}>Start a Voice Session</h1>
        <p className={styles.subtitle}>Choose your AI expert and language to begin</p>

        <span className={styles.sectionLabel}>CHOOSE YOUR AI EXPERT</span>
        <div className={styles.expertGrid}>
          {SELECTABLE_VOICE_EXPERTS.map((expert) => (
            <ExpertCard
              key={expert.id}
              expert={expert}
              selected={expert.id === selectedExpertId}
              onSelect={() => setSelectedExpertId(expert.id)}
            />
          ))}
        </div>

        <span className={styles.sectionLabel}>SELECT LANGUAGE</span>
        <div className={styles.languageRow}>
          {LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={option === language ? styles.langPillSelected : styles.langPill}
              onClick={() => setLanguage(option)}
            >
              {option}
            </button>
          ))}
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button type="button" className={styles.startButton} onClick={handleStart} disabled={pending}>
          <PlayIcon size={16} />
          {pending ? "Starting…" : `Start Voice Chat with ${selectedExpert.name}`}
        </button>

        <button type="button" className={styles.customSetupLink} disabled>
          <WandIcon size={13} />
          Custom topic &amp; avatar setup
          <ChevronRightIcon size={12} />
        </button>
      </div>
    </div>
  );
}
