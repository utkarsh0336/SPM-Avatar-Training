"use client";

import { useEffect, useRef } from "react";
import styles from "./EndSessionDialog.module.css";

interface EndSessionDialogProps {
  onCancel: () => void;
  onConfirm: () => void;
}

// Not shown in the reference screenshot — required by the spec's Conversation
// Flow ("end confirmation" step). Traps focus between its two buttons and
// returns it to the End Session control on cancel (handled by the caller via
// the ref it passed to onCancel's trigger). See
// .claude/specs/video-chat-session.md Accessibility / Focus management.
export function EndSessionDialog({ onCancel, onConfirm }: EndSessionDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key === "Tab") {
        const first = cancelRef.current;
        const last = confirmRef.current;
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="end-session-title">
        <span id="end-session-title" className={styles.title}>
          End this session?
        </span>
        <span className={styles.body}>
          The conversation transcript will be saved. You won&apos;t be able to rejoin this session
          once it ends.
        </span>
        <div className={styles.actions}>
          <button ref={cancelRef} type="button" className={styles.cancelButton} onClick={onCancel}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" className={styles.confirmButton} onClick={onConfirm}>
            End Session
          </button>
        </div>
      </div>
    </div>
  );
}
