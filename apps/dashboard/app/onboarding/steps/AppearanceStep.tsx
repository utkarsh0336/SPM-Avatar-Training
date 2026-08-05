"use client";

import { useRouter } from "next/navigation";
import { useOnboarding } from "../OnboardingContext";
import { PillPicker } from "../PillPicker";
import { SwatchPicker } from "../SwatchPicker";
import { WizardNav } from "../WizardNav";
import {
  HAIR_COLOR_OPTIONS,
  HAIR_COLOR_SWATCHES,
  HAIR_STYLE_LABELS,
  SKIN_TONE_OPTIONS,
  SKIN_TONE_SWATCHES,
  type HairStyle,
} from "../types";
import shared from "./steps.module.css";

const HAIR_STYLE_OPTIONS: readonly HairStyle[] = ["SHORT", "MEDIUM", "LONG", "CURLY", "WAVY", "BALD"];

export function AppearanceStep() {
  const { state, update } = useOnboarding();
  const router = useRouter();

  return (
    <div>
      <h1 className={shared.heading}>Customize Appearance</h1>
      <p className={shared.subheading}>Pick skin tone, hair style &amp; color</p>

      <div className={shared.section}>
        <span className={shared.sectionLabel}>SKIN TONE</span>
        <SwatchPicker
          options={SKIN_TONE_OPTIONS}
          colors={SKIN_TONE_SWATCHES}
          selected={state.skinTone}
          onSelect={(value) => update({ skinTone: value })}
        />
      </div>

      <div className={shared.section}>
        <span className={shared.sectionLabel}>HAIR STYLE</span>
        <PillPicker
          options={HAIR_STYLE_OPTIONS}
          labels={HAIR_STYLE_LABELS}
          selected={state.hairStyle}
          onSelect={(value) => update({ hairStyle: value })}
        />
      </div>

      <div className={shared.section}>
        <span className={shared.sectionLabel}>HAIR COLOR</span>
        <SwatchPicker
          options={HAIR_COLOR_OPTIONS}
          colors={HAIR_COLOR_SWATCHES}
          selected={state.hairColor}
          onSelect={(value) => update({ hairColor: value })}
        />
      </div>

      <WizardNav
        onBack={() => router.push("/onboarding/2")}
        onContinue={() => router.push("/onboarding/4")}
      />
    </div>
  );
}
