import styles from "./SidePanel.module.css";
import { CameraOffIcon, MicIcon, UserIcon } from "../icons";

interface CameraPreviewProps {
  cameraOff: boolean;
  muted: boolean;
}

// Milestone 1: visual placeholder only, no getUserMedia call — real camera
// access is a Milestone 3+ concern per the spec's Implementation Plan.
export function CameraPreview({ cameraOff, muted }: CameraPreviewProps) {
  return (
    <div>
      <span className={styles.sectionLabel}>YOUR CAMERA</span>
      <div className={`${styles.cameraFrame} ${cameraOff ? styles.cameraOffFrame : ""}`}>
        <div className={styles.cameraPlaceholder}>
          {cameraOff ? <CameraOffIcon size={28} /> : <UserIcon size={40} />}
        </div>
        {!muted && (
          <span className={styles.micBadge}>
            <MicIcon size={12} />
          </span>
        )}
        <span className={styles.youBadge}>
          <span className={styles.youDot} />
          YOU
        </span>
      </div>
    </div>
  );
}
