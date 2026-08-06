"use client";

import { useState, type FormEvent } from "react";
import { acceptInvite } from "../../lib/api-client";
import styles from "./page.module.css";

export function AcceptInviteForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("This invite link is missing its token.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await acceptInvite(token, password);
      window.location.assign("/");
    } catch {
      setError("This invite link is invalid or has expired.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Set your password</h1>
      <p className={styles.subtitle}>Finish setting up your account to join the organization</p>

      <form onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className={styles.input}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.submit} disabled={submitting}>
          {submitting ? "Setting password…" : "Set password & sign in"}
        </button>
      </form>
    </div>
  );
}
