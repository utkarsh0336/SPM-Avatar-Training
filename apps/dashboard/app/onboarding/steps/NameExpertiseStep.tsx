"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOnboarding } from "../OnboardingContext";
import { PillPicker } from "../PillPicker";
import { WizardNav } from "../WizardNav";
import { EXPERTISE_LABELS, type Expertise } from "../types";
import shared from "./steps.module.css";
import styles from "./NameExpertiseStep.module.css";

const EXPERTISE_OPTIONS: readonly Expertise[] = [
  "HR_LEAVE_POLICY",
  "SALES_NEGOTIATION",
  "COMPLIANCE_LEGAL",
  "PRODUCT_TRAINING",
  "CUSTOMER_SUPPORT",
  "LEADERSHIP_MANAGEMENT",
  "FINANCE_ACCOUNTING",
  "IT_TECHNOLOGY",
  "MARKETING_BRANDING",
];

function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 60;
}

export function NameExpertiseStep() {
  const { state, update } = useOnboarding();
  const router = useRouter();
  const [nameTouched, setNameTouched] = useState(false);

  const nameError = nameTouched && !isValidName(state.name) ? "Avatar name is required" : null;

  return (
    <div>
      <h1 className={shared.heading}>Name &amp; Expertise</h1>
      <p className={shared.subheading}>Give your avatar a name and choose what they teach</p>

      <div className={shared.section}>
        <span className={shared.sectionLabel}>AVATAR NAME</span>
        <input
          type="text"
          className={styles.input}
          placeholder="e.g. Alex, Jordan, Priya…"
          value={state.name}
          onChange={(event) => update({ name: event.target.value })}
          onBlur={() => setNameTouched(true)}
          maxLength={60}
        />
        {nameError && <span className={styles.error}>{nameError}</span>}
      </div>

      <div className={shared.section}>
        <span className={shared.sectionLabel}>AREA OF EXPERTISE</span>
        <PillPicker
          options={EXPERTISE_OPTIONS}
          labels={EXPERTISE_LABELS}
          selected={state.expertise}
          onSelect={(value) => update({ expertise: value })}
        />
      </div>

      <WizardNav
        onBack={() => router.push("/onboarding/4")}
        onContinue={() => {
          if (!isValidName(state.name)) {
            setNameTouched(true);
            return;
          }
          router.push("/onboarding/6");
        }}
      />
    </div>
  );
}
