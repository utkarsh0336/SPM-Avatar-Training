"use client";

import styles from "./ExpertCard.module.css";
import { CheckIcon } from "../onboarding/icons";
import type { VoiceExpert } from "../../lib/fixtures/voice-experts";

interface ExpertCardProps {
  expert: VoiceExpert;
  selected: boolean;
  onSelect: () => void;
}

export function ExpertCard({ expert, selected, onSelect }: ExpertCardProps) {
  return (
    <button
      type="button"
      className={selected ? styles.cardSelected : styles.card}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className={styles.thumbnail}>
        <img src={expert.photoSrc} alt="" className={styles.thumbnailImage} />
        {selected && (
          <span className={styles.checkBadge}>
            <CheckIcon size={12} />
          </span>
        )}
      </div>
      <div className={styles.body}>
        <span className={styles.name}>{expert.name}</span>
        <span className={styles.subtitle}>Multi-topic</span>
      </div>
    </button>
  );
}
