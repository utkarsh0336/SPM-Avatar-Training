"use client";

import styles from "./PillPicker.module.css";

interface PillPickerProps<T extends string> {
  options: readonly T[];
  labels: Record<T, string>;
  selected: T;
  onSelect: (value: T) => void;
}

export function PillPicker<T extends string>({ options, labels, selected, onSelect }: PillPickerProps<T>) {
  return (
    <div className={styles.row}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={option === selected ? styles.pillSelected : styles.pill}
          onClick={() => onSelect(option)}
          aria-pressed={option === selected}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}
