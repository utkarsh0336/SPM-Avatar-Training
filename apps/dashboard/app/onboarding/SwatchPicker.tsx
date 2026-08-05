"use client";

import styles from "./SwatchPicker.module.css";

interface SwatchPickerProps {
  options: readonly string[];
  colors: Record<string, string>;
  selected: string;
  onSelect: (value: string) => void;
  getLabel?: (value: string) => string;
}

export function SwatchPicker({ options, colors, selected, onSelect, getLabel }: SwatchPickerProps) {
  return (
    <div className={styles.row}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={option === selected ? styles.swatchSelected : styles.swatch}
          style={{ background: colors[option] }}
          onClick={() => onSelect(option)}
          aria-pressed={option === selected}
          aria-label={getLabel ? getLabel(option) : option}
        />
      ))}
    </div>
  );
}
