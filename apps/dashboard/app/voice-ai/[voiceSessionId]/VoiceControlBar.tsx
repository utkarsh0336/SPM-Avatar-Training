"use client";

import { useState } from "react";
import type { Language } from "@avatrain/shared/tutor";
import styles from "./VoiceControlBar.module.css";
import { EndCallIcon, GlobeIcon, MicIcon, MicOffIcon, PanelIcon, PauseIcon, PlayIcon } from "../../sessions/icons";
import { useVoiceSessionUi } from "./VoiceSessionUiContext";

const LANGUAGE_OPTIONS: Language[] = ["English", "Hindi"];

interface VoiceControlBarProps {
  onEndSession: () => void;
}

// Voice AI's counterpart to sessions/[trainingSessionId]/ControlBar.tsx: no
// Camera/Fullscreen (voice-only), and the panel toggle here reads "Transcript"
// when hidden / "Hide" when shown per the reference screenshots (Page 2 vs
// Page 3), rather than "Show Panel"/"Hide Panel". Mute and Pause are two
// distinct controls in the design; both gate the same mic track (see
// VoiceStage.tsx's doc comment) since the transport has no separate pause
// primitive.
export function VoiceControlBar({ onEndSession }: VoiceControlBarProps) {
  const { state, update } = useVoiceSessionUi();
  const [languageOpen, setLanguageOpen] = useState(false);

  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={`${styles.control} ${state.muted ? styles.controlEngaged : ""}`}
        aria-pressed={state.muted}
        onClick={() => update({ muted: !state.muted })}
      >
        {state.muted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
        Mute
      </button>

      <button
        type="button"
        className={`${styles.control} ${state.paused ? styles.controlEngaged : ""}`}
        aria-pressed={state.paused}
        onClick={() => update({ paused: !state.paused })}
      >
        {state.paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
        {state.paused ? "Resume" : "Pause"}
      </button>

      <div style={{ position: "relative" }}>
        {languageOpen && (
          <div className={styles.languagePopover}>
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.languageOption} ${
                  state.language === option ? styles.languageOptionSelected : ""
                }`}
                onClick={() => {
                  update({ language: option });
                  setLanguageOpen(false);
                }}
              >
                {option}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className={styles.control}
          aria-expanded={languageOpen}
          onClick={() => setLanguageOpen((open) => !open)}
        >
          <GlobeIcon size={18} />
          {state.language}
        </button>
      </div>

      <button
        type="button"
        className={`${styles.control} ${state.panelVisible ? styles.controlEngaged : ""}`}
        aria-pressed={state.panelVisible}
        onClick={() => update({ panelVisible: !state.panelVisible })}
      >
        <PanelIcon size={18} />
        {state.panelVisible ? "Hide" : "Transcript"}
      </button>

      <button
        id="end-voice-session-trigger"
        type="button"
        className={`${styles.control} ${styles.endControl}`}
        onClick={onEndSession}
      >
        <EndCallIcon size={18} />
        End
      </button>
    </div>
  );
}
