"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, completeOnboarding } from "../../../lib/api-client";
import { AvatarSummaryPanel } from "../AvatarSummaryPanel";
import { IconOptionCard } from "../IconOptionCard";
import { useOnboarding } from "../OnboardingContext";
import { WizardNav } from "../WizardNav";
import { HeartIcon, MicIcon, SparkleIcon, VolumeIcon, type IconComponent } from "../icons";
import { EXPERTISE_LABELS, VOICE_LABELS, VOICE_SUBTITLES, type VoiceTone } from "../types";
import { useSessions } from "../../sessions/SessionsContext";
import shared from "./steps.module.css";
import styles from "./VoiceReviewStep.module.css";

const VOICE_OPTIONS: { value: VoiceTone; Icon: IconComponent }[] = [
  { value: "DEEP", Icon: MicIcon },
  { value: "NEUTRAL", Icon: VolumeIcon },
  { value: "WARM", Icon: HeartIcon },
];

export function VoiceReviewStep() {
  const { state, update, flush } = useOnboarding();
  const { addSession } = useSessions();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue(): Promise<void> {
    // A second click while pending is a no-op — see onboarding.md Step 6.
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // Flush any not-yet-autosaved change (e.g. this step's own voice pick)
      // before validating server-side, so a fast click-through can't lose it.
      await flush();
      await completeOnboarding();
      // useConversationSession.ts now reads the persisted Avatar record
      // (GET /v1/avatars/mine) rather than a localStorage handoff — see
      // avatar-builder-customization.md's Implementation Assumptions #5,
      // closed. No client-side handoff write needed here anymore.
      // Create the session and go straight into it — landing on /sessions
      // (the hub) after finishing the builder meant a second manual "New
      // Video Chat" step just to reach a live avatar, when the whole point
      // of "Create Avatar & Start Session" is that it does both.
      const created = await addSession({
        title: state.name.trim() || "My Avatar",
        topic: EXPERTISE_LABELS[state.expertise],
      });
      router.push(`/sessions/${created.id}`);
    } catch (err) {
      const fields = err instanceof ApiError ? err.body.fields : undefined;
      const detail = fields?.length
        ? ` Missing/invalid: ${fields.map((f) => f.path).join(", ")}.`
        : "";
      setError(
        err instanceof ApiError
          ? `${err.body.message ?? "Could not complete onboarding."}${detail}`
          : "Could not reach the server. Please try again.",
      );
      setPending(false);
    }
  }

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

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <WizardNav
        onBack={() => router.push("/onboarding/6")}
        onContinue={handleContinue}
        continueDisabled={pending}
        continueLabel={pending ? "Creating Avatar…" : "Create Avatar & Start Session"}
        continueIcon={<SparkleIcon size={16} />}
        continueIconPosition="start"
      />
    </div>
  );
}
