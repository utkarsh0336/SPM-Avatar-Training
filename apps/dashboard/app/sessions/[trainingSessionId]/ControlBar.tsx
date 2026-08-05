"use client";

import { useState } from "react";
import styles from "./ControlBar.module.css";
import {
  CameraIcon,
  CameraOffIcon,
  EndCallIcon,
  ExpandIcon,
  GlobeIcon,
  MicIcon,
  MicOffIcon,
  PanelIcon,
} from "../icons";
import { useTrainingSessionUi } from "./TrainingSessionContext";

const LANGUAGE_OPTIONS = ["English", "Spanish", "French", "German", "Hindi"];

interface ControlBarProps {
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onEndSession: () => void;
}

// Session Controls — exact behaviors defined in
// .claude/specs/video-chat-session.md UI Changes / "Session Controls — exact
// behavior". Mute/Camera/Language/Hide-Panel are pure UI-toggle state here
// (TrainingSessionContext); Fullscreen is native browser state passed in as a
// prop; End Session opens the confirmation dialog rather than ending directly.
export function ControlBar({ fullscreen, onToggleFullscreen, onEndSession }: ControlBarProps) {
  const { state, update } = useTrainingSessionUi();
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
        className={`${styles.control} ${state.cameraOff ? styles.controlEngaged : ""}`}
        aria-pressed={state.cameraOff}
        onClick={() => update({ cameraOff: !state.cameraOff })}
      >
        {state.cameraOff ? <CameraOffIcon size={18} /> : <CameraIcon size={18} />}
        Camera
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
          Language
        </button>
      </div>

      <button
        type="button"
        className={`${styles.control} ${!state.panelVisible ? styles.controlEngaged : ""}`}
        aria-pressed={!state.panelVisible}
        onClick={() => update({ panelVisible: !state.panelVisible })}
      >
        <PanelIcon size={18} />
        {state.panelVisible ? "Hide Panel" : "Show Panel"}
      </button>

      <button
        type="button"
        className={`${styles.control} ${fullscreen ? styles.controlEngaged : ""}`}
        aria-pressed={fullscreen}
        onClick={onToggleFullscreen}
      >
        <ExpandIcon size={18} />
        Fullscreen
      </button>

      <button
        id="end-session-trigger"
        type="button"
        className={`${styles.control} ${styles.endControl}`}
        onClick={onEndSession}
      >
        <EndCallIcon size={18} />
        End Session
      </button>
    </div>
  );
}
