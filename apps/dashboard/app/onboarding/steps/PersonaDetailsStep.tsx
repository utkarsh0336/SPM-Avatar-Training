"use client";

import { useRouter } from "next/navigation";
import { useOnboarding } from "../OnboardingContext";
import { PillPicker } from "../PillPicker";
import { WizardNav } from "../WizardNav";
import {
  AGE_GROUP_LABELS,
  AVATAR_LANGUAGE_LABELS,
  AVATAR_REGION_LABELS,
  type AgeGroup,
  type AvatarLanguage,
  type AvatarRegion,
} from "../types";
import shared from "./steps.module.css";

const AGE_GROUP_OPTIONS: readonly AgeGroup[] = ["YOUNG_ADULT", "MIDDLE_AGED", "SENIOR"];
const AVATAR_REGION_OPTIONS: readonly AvatarRegion[] = [
  "GLOBAL",
  "INDIA",
  "NORTH_AMERICA",
  "EUROPE",
  "MIDDLE_EAST",
  "APAC",
];
const AVATAR_LANGUAGE_OPTIONS: readonly AvatarLanguage[] = ["ENGLISH", "HINDI"];

/**
 * SOW §3.1 "various age groups" / "regional and language-specific avatars" —
 * a single combined step (not three) to avoid growing the wizard by more
 * than one screen. Metadata only, same as NameExpertiseStep's expertise
 * field: never fed into resolveReplicaId, never completion-required.
 */
export function PersonaDetailsStep() {
  const { state, update } = useOnboarding();
  const router = useRouter();

  return (
    <div>
      <h1 className={shared.heading}>Persona Details</h1>
      <p className={shared.subheading}>Fine-tune who this avatar is meant to represent</p>

      <div className={shared.section}>
        <span className={shared.sectionLabel}>AGE GROUP</span>
        <PillPicker
          options={AGE_GROUP_OPTIONS}
          labels={AGE_GROUP_LABELS}
          selected={state.ageGroup}
          onSelect={(value) => update({ ageGroup: value })}
        />
      </div>

      <div className={shared.section}>
        <span className={shared.sectionLabel}>REGION</span>
        <PillPicker
          options={AVATAR_REGION_OPTIONS}
          labels={AVATAR_REGION_LABELS}
          selected={state.region}
          onSelect={(value) => update({ region: value })}
        />
      </div>

      <div className={shared.section}>
        <span className={shared.sectionLabel}>PREFERRED LANGUAGE</span>
        <PillPicker
          options={AVATAR_LANGUAGE_OPTIONS}
          labels={AVATAR_LANGUAGE_LABELS}
          selected={state.preferredLanguage}
          onSelect={(value) => update({ preferredLanguage: value })}
        />
      </div>

      <WizardNav onBack={() => router.push("/onboarding/5")} onContinue={() => router.push("/onboarding/7")} />
    </div>
  );
}
