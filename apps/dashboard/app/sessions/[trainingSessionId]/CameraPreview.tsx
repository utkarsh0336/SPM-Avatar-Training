"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./SidePanel.module.css";
import { CameraOffIcon, MicIcon, UserIcon } from "../icons";

interface CameraPreviewProps {
  cameraOff: boolean;
  muted: boolean;
}

/**
 * The trainer's own front-camera self-view — real getUserMedia video
 * capture, mirrored like a normal video-call self-preview. Never sent
 * anywhere (unlike the mic track in useConversationSession.ts, this never
 * touches the WS/realtime pipeline — it's a local-only preview), so it's
 * kept self-contained here rather than lifted into the conversation hook.
 * Stops the camera track whenever ControlBar's Camera toggle sets
 * cameraOff, and falls back to a placeholder icon on permission denial/no
 * camera rather than showing a broken video element.
 */
export function CameraPreview({ cameraOff, muted }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (cameraOff) return;

    let cancelled = false;
    let stream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((mediaStream) => {
        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = mediaStream;
        setError(false);
        if (videoRef.current) videoRef.current.srcObject = mediaStream;
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraOff]);

  const showVideo = !cameraOff && !error;

  return (
    <div>
      <span className={styles.sectionLabel}>YOUR CAMERA</span>
      <div className={`${styles.cameraFrame} ${cameraOff ? styles.cameraOffFrame : ""}`}>
        {showVideo ? (
          <video ref={videoRef} className={styles.cameraVideo} autoPlay playsInline muted />
        ) : (
          <div className={styles.cameraPlaceholder}>
            {cameraOff ? <CameraOffIcon size={28} /> : <UserIcon size={40} />}
          </div>
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
