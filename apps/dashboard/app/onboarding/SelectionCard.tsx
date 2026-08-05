"use client";

import type { ReactNode } from "react";
import styles from "./SelectionCard.module.css";
import { CheckIcon } from "./icons";

interface SelectionCardProps {
  title: string;
  subtitle: string;
  icon: ReactNode;
  selected: boolean;
  onSelect: () => void;
  thumbnailIcon?: ReactNode;
  thumbnailGradient?: string;
}

export function SelectionCard({
  title,
  subtitle,
  icon,
  selected,
  onSelect,
  thumbnailIcon,
  thumbnailGradient,
}: SelectionCardProps) {
  return (
    <button
      type="button"
      className={selected ? styles.cardSelected : styles.card}
      onClick={onSelect}
      aria-pressed={selected}
    >
      {thumbnailIcon && (
        <div className={styles.thumbnail} style={thumbnailGradient ? { background: thumbnailGradient } : undefined}>
          {thumbnailIcon}
          {selected && (
            <span className={styles.checkBadge}>
              <CheckIcon size={12} />
            </span>
          )}
        </div>
      )}

      <div className={styles.body}>
        <span className={selected ? styles.iconSelected : styles.icon}>{icon}</span>
        <span className={styles.text}>
          <span className={selected ? styles.titleSelected : styles.title}>{title}</span>
          <span className={styles.subtitle}>{subtitle}</span>
        </span>
      </div>
    </button>
  );
}
