"use client";

import type { ReactNode } from "react";
import styles from "./RowOptionCard.module.css";
import { CheckIcon, UserIcon } from "./icons";

interface RowOptionCardProps {
  title: string;
  subtitle: string;
  icon: ReactNode;
  gradient: string;
  photoUrl?: string;
  selected: boolean;
  onSelect: () => void;
}

export function RowOptionCard({ title, subtitle, icon, gradient, photoUrl, selected, onSelect }: RowOptionCardProps) {
  return (
    <button
      type="button"
      className={selected ? styles.rowSelected : styles.row}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className={styles.thumbnail} style={photoUrl ? undefined : { background: gradient }}>
        {photoUrl ? (
          <img src={photoUrl} alt="" className={styles.thumbnailImage} />
        ) : (
          <UserIcon size={28} className={styles.thumbnailIcon} />
        )}
      </div>

      <span className={selected ? styles.iconBadgeSelected : styles.iconBadge}>{icon}</span>

      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        <span className={styles.subtitle}>{subtitle}</span>
      </span>

      {selected && (
        <span className={styles.checkBadge}>
          <CheckIcon size={12} />
        </span>
      )}
    </button>
  );
}
