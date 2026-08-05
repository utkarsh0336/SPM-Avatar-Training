"use client";

import type { ReactNode } from "react";
import styles from "./WizardNav.module.css";
import { ArrowLeftIcon, ArrowRightIcon } from "./icons";

interface WizardNavProps {
  onBack: () => void;
  onContinue: () => void;
  backDisabled?: boolean;
  continueDisabled?: boolean;
  continueLabel?: string;
  continueIcon?: ReactNode;
  continueIconPosition?: "start" | "end";
}

export function WizardNav({
  onBack,
  onContinue,
  backDisabled = false,
  continueDisabled = false,
  continueLabel = "Continue",
  continueIcon = <ArrowRightIcon size={16} />,
  continueIconPosition = "end",
}: WizardNavProps) {
  return (
    <div className={styles.nav}>
      <button type="button" className={styles.back} onClick={onBack} disabled={backDisabled}>
        <ArrowLeftIcon size={16} />
        Back
      </button>
      <button type="button" className={styles.continue} onClick={onContinue} disabled={continueDisabled}>
        {continueIconPosition === "start" && continueIcon}
        {continueLabel}
        {continueIconPosition === "end" && continueIcon}
      </button>
    </div>
  );
}
