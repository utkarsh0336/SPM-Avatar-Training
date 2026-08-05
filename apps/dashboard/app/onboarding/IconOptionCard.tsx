"use client";

import type { ReactNode } from "react";
import styles from "./IconOptionCard.module.css";

interface IconOptionCardProps {
  title: string;
  subtitle: string;
  icon: ReactNode;
  selected: boolean;
  onSelect: () => void;
}

export function IconOptionCard({ title, subtitle, icon, selected, onSelect }: IconOptionCardProps) {
  return (
    <button
      type="button"
      className={selected ? styles.cardSelected : styles.card}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className={selected ? styles.iconBadgeSelected : styles.iconBadge}>{icon}</span>
      <span className={styles.title}>{title}</span>
      <span className={styles.subtitle}>{subtitle}</span>
    </button>
  );
}
