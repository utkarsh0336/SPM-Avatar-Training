"use client";

import { useRouter } from "next/navigation";
import { useOnboarding } from "../OnboardingContext";
import { SelectionCard } from "../SelectionCard";
import { WizardNav } from "../WizardNav";
import { CameraIcon, CubeIcon, PaletteIcon, type IconComponent } from "../icons";
import { GENDER_PHOTOS, type AvatarStyle } from "../types";
import shared from "./steps.module.css";
import styles from "./StyleStep.module.css";

const STYLE_OPTIONS: {
  value: AvatarStyle;
  title: string;
  subtitle: string;
  Icon: IconComponent;
}[] = [
  {
    value: "REALISTIC",
    title: "Realistic",
    subtitle: "Photo-realistic AI avatar",
    Icon: CameraIcon,
  },
  {
    value: "ANIMATED",
    title: "Animated",
    subtitle: "Illustrated 2D style",
    Icon: PaletteIcon,
  },
  {
    value: "STYLIZED_3D",
    title: "3D Stylized",
    subtitle: "Rendered 3D character",
    Icon: CubeIcon,
  },
];

export function StyleStep() {
  const { state, update } = useOnboarding();
  const router = useRouter();

  return (
    <div>
      <h1 className={shared.heading}>Choose Avatar Style</h1>
      <p className={shared.subheading}>How should your AI avatar look?</p>

      <div className={styles.grid}>
        {STYLE_OPTIONS.map((option) => (
          <SelectionCard
            key={option.value}
            title={option.title}
            subtitle={option.subtitle}
            icon={<option.Icon size={16} />}
            thumbnailIcon={<option.Icon size={28} />}
            thumbnailPhotoUrl={option.value === "REALISTIC" ? GENDER_PHOTOS[state.gender] : undefined}
            selected={state.style === option.value}
            onSelect={() => update({ style: option.value })}
          />
        ))}
      </div>

      <WizardNav
        backDisabled
        continueDisabled={state.style === null}
        onBack={() => {}}
        onContinue={() => router.push("/onboarding/2")}
      />
    </div>
  );
}
