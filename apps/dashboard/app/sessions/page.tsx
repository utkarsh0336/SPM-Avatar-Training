import styles from "./page.module.css";

export default function SessionsIndexPage() {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyTitle}>Select a session</span>
      <span>Choose a pinned or recent session, or start a new video chat.</span>
    </div>
  );
}
