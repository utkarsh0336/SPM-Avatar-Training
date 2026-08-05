"use client";

import { useRouter } from "next/navigation";
import { useOnboarding } from "../OnboardingContext";
import { RowOptionCard } from "../RowOptionCard";
import { WizardNav } from "../WizardNav";
import {
  BriefcaseIcon,
  CoffeeIcon,
  GraduationCapIcon,
  LaptopIcon,
  LayersIcon,
  type IconComponent,
} from "../icons";
import { OUTFIT_GRADIENTS, OUTFIT_SUBTITLES, OUTFIT_TITLES, type Outfit } from "../types";
import shared from "./steps.module.css";
import styles from "./OutfitStep.module.css";

const OUTFIT_OPTIONS: { value: Outfit; Icon: IconComponent }[] = [
  { value: "BUSINESS_FORMAL", Icon: BriefcaseIcon },
  { value: "BUSINESS_CASUAL", Icon: CoffeeIcon },
  { value: "SMART_PROFESSIONAL", Icon: LayersIcon },
  { value: "TECH_CREATIVE", Icon: LaptopIcon },
  { value: "ACADEMIC_EDUCATOR", Icon: GraduationCapIcon },
];

export function OutfitStep() {
  const { state, update } = useOnboarding();
  const router = useRouter();

  return (
    <div>
      <h1 className={shared.heading}>Choose Outfit</h1>
      <p className={shared.subheading}>Select the clothing style — preview updates live</p>

      <div className={styles.list}>
        {OUTFIT_OPTIONS.map((option) => (
          <RowOptionCard
            key={option.value}
            title={OUTFIT_TITLES[option.value]}
            subtitle={OUTFIT_SUBTITLES[option.value]}
            gradient={OUTFIT_GRADIENTS[option.value]}
            icon={<option.Icon size={18} />}
            selected={state.outfit === option.value}
            onSelect={() => update({ outfit: option.value })}
          />
        ))}
      </div>

      <WizardNav
        onBack={() => router.push("/onboarding/3")}
        onContinue={() => router.push("/onboarding/5")}
      />
    </div>
  );
}
