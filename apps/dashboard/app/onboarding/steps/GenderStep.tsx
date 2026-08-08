"use client";

import { useRouter } from "next/navigation";
import { useOnboarding } from "../OnboardingContext";
import { PhotoOptionCard } from "../PhotoOptionCard";
import { WizardNav } from "../WizardNav";
import { GENDER_GRADIENTS, GENDER_LABELS, GENDER_PHOTOS, type Gender } from "../types";
import shared from "./steps.module.css";
import styles from "./GenderStep.module.css";

const GENDER_OPTIONS: Gender[] = ["FEMALE", "MALE", "NEUTRAL"];

export function GenderStep() {
  const { state, update } = useOnboarding();
  const router = useRouter();

  return (
    <div>
      <h1 className={shared.heading}>Choose Gender</h1>
      <p className={shared.subheading}>Select the gender presentation for your avatar</p>

      <div className={styles.grid}>
        {GENDER_OPTIONS.map((option) => (
          <PhotoOptionCard
            key={option}
            label={GENDER_LABELS[option]}
            gradient={GENDER_GRADIENTS[option]}
            photoUrl={GENDER_PHOTOS[option]}
            selected={state.gender === option}
            onSelect={() => update({ gender: option })}
          />
        ))}
      </div>

      <WizardNav
        onBack={() => router.push("/onboarding/1")}
        onContinue={() => router.push("/onboarding/3")}
      />
    </div>
  );
}
