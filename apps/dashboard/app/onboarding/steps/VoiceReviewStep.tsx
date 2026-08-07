"use client";

import { useRouter } from "next/navigation";
import { AvatarSummaryPanel } from "../AvatarSummaryPanel";
import { IconOptionCard } from "../IconOptionCard";
import { useOnboarding } from "../OnboardingContext";
import { WizardNav } from "../WizardNav";
import { HeartIcon, MicIcon, SparkleIcon, VolumeIcon, type IconComponent } from "../icons";
import { VOICE_LABELS, VOICE_SUBTITLES, type VoiceTone } from "../types";
import { writeOnboardingAvatarHandoff } from "../../../lib/onboarding-handoff";
import shared from "./steps.module.css";
import styles from "./VoiceReviewStep.module.css";

const VOICE_OPTIONS: { value: VoiceTone; Icon: IconComponent }[] = [
  { value: "DEEP", Icon: MicIcon },
  { value: "NEUTRAL", Icon: VolumeIcon },
  { value: "WARM", Icon: HeartIcon },
];

export function VoiceReviewStep() {
  const { state, update } = useOnboarding();
  const router = useRouter();

  return (
    <div>
      <h1 className={shared.heading}>Voice &amp; Final Review</h1>
      <p className={shared.subheading}>Choose your avatar&rsquo;s voice tone, then confirm</p>

      <div className={styles.grid}>
        {VOICE_OPTIONS.map((option) => (
          <IconOptionCard
            key={option.value}
            title={VOICE_LABELS[option.value]}
            subtitle={VOICE_SUBTITLES[option.value]}
            icon={<option.Icon size={22} />}
            selected={state.voice === option.value}
            onSelect={() => update({ voice: option.value })}
          />
        ))}
      </div>

      <AvatarSummaryPanel />

      <WizardNav
        onBack={() => router.push("/onboarding/5")}
        onContinue={() => {
          // "/" is the unrelated Phase-0 trainer/admin scaffold, not a
          // session — it has no session-start UI, so landing there after
          // onboarding reads as onboarding having done nothing. /sessions is
          // the actual AI Avatar Hub (SessionsProvider + "start a new video
          // chat"), the only place a session can be created.
          writeOnboardingAvatarHandoff(state);
          router.push("/sessions");
        }}
        continueLabel="Create Avatar & Start Session"
        continueIcon={<SparkleIcon size={16} />}
        continueIconPosition="start"
      />
    </div>
  );
}
