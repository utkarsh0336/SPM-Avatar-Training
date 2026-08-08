"use client";

import styles from "./PhotoOptionCard.module.css";
import { CheckIcon, UserIcon } from "./icons";

interface PhotoOptionCardProps {
  label: string;
  gradient: string;
  photoUrl?: string;
  selected: boolean;
  onSelect: () => void;
}

export function PhotoOptionCard({ label, gradient, photoUrl, selected, onSelect }: PhotoOptionCardProps) {
  return (
    <button
      type="button"
      className={selected ? styles.cardSelected : styles.card}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className={styles.photo} style={photoUrl ? undefined : { background: gradient }}>
        {photoUrl ? (
          <img src={photoUrl} alt="" className={styles.photoImage} />
        ) : (
          <UserIcon size={48} className={styles.photoIcon} />
        )}
        {selected && (
          <span className={styles.checkBadge}>
            <CheckIcon size={12} />
          </span>
        )}
      </div>
      <div className={selected ? styles.labelBarSelected : styles.labelBar}>{label}</div>
    </button>
  );
}
