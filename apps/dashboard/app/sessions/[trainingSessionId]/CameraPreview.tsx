import { useState } from "react";
import styles from "./SidePanel.module.css";
import { CameraOffIcon, MicIcon, UserIcon } from "../icons";

interface CameraPreviewProps {
  cameraOff: boolean;
  muted: boolean;
}

// No real getUserMedia video capture is wired up here — this is a static
// photo standing in for the trainer's own camera feed, per the reference
// screenshot. Live camera capture is a separate, unrelated feature.
// Falls back to the icon placeholder if /camera-preview.jpg hasn't been
// provided yet, rather than showing a broken image.
export function CameraPreview({ cameraOff, muted }: CameraPreviewProps) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <div>
      <span className={styles.sectionLabel}>YOUR CAMERA</span>
      <div className={`${styles.cameraFrame} ${cameraOff ? styles.cameraOffFrame : ""}`}>
        {cameraOff || imageFailed ? (
          <div className={styles.cameraPlaceholder}>
            {cameraOff ? <CameraOffIcon size={28} /> : <UserIcon size={40} />}
          </div>
        ) : (
          <img
            src="/camera-preview.jpg"
            alt="Your camera preview"
            className={styles.cameraImage}
            onError={() => setImageFailed(true)}
          />
        )}
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
