import { notFound } from "next/navigation";
import { StyleStep } from "../steps/StyleStep";
import { GenderStep } from "../steps/GenderStep";
import { AppearanceStep } from "../steps/AppearanceStep";
import { OutfitStep } from "../steps/OutfitStep";
import { NameExpertiseStep } from "../steps/NameExpertiseStep";
import { PersonaDetailsStep } from "../steps/PersonaDetailsStep";
import { VoiceReviewStep } from "../steps/VoiceReviewStep";

export default async function OnboardingStepPage({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const { step } = await params;

  switch (step) {
    case "1":
      return <StyleStep />;
    case "2":
      return <GenderStep />;
    case "3":
      return <AppearanceStep />;
    case "4":
      return <OutfitStep />;
    case "5":
      return <NameExpertiseStep />;
    case "6":
      return <PersonaDetailsStep />;
    case "7":
      return <VoiceReviewStep />;
    default:
      notFound();
  }
}
