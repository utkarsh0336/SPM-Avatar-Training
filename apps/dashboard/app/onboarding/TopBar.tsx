"use client";

import Link from "next/link";
import styles from "./TopBar.module.css";
import { ArrowLeftIcon } from "./icons";
import { TOTAL_STEPS } from "./types";

interface TopBarProps {
  step: number;
}

export function TopBar({ step }: TopBarProps) {
  return (
    <header className={styles.topBar}>
      <Link href="/" className={styles.back}>
        <ArrowLeftIcon size={16} />
        <span>Back</span>
      </Link>

      <div className={styles.title}>
        <span className={styles.titleText}>Avatar Builder</span>
        <span className={styles.stepText}>
          Step {step} of {TOTAL_STEPS}
        </span>
      </div>

      <div className={styles.progress} role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-valuenow={step}>
        {Array.from({ length: TOTAL_STEPS }, (_, index) => index + 1).map((stepNumber) => (
          <span
            key={stepNumber}
            className={
              stepNumber === step
                ? styles.progressActive
                : stepNumber < step
                  ? styles.progressCompleted
                  : styles.progressDot
            }
          />
        ))}
      </div>
    </header>
  );
}
