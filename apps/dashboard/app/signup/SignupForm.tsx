"use client";

import { useState, type FormEvent } from "react";
import { ApiError, postLoginRedirectTarget, signup } from "../../lib/api-client";
import styles from "./page.module.css";

export function SignupForm() {
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await signup(orgName, email, password);
      window.location.assign(postLoginRedirectTarget(result.user));
    } catch (err) {
      if (err instanceof ApiError && err.body.error === "email_taken") {
        setError("An account with that email already exists.");
      } else {
        setError("Couldn't create your account. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Create your organization</h1>
      <p className={styles.subtitle}>Start training with your AI avatar in minutes</p>

      <form onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="orgName">
            Organization name
          </label>
          <input
            id="orgName"
            type="text"
            className={styles.input}
            placeholder="Acme Inc."
            autoComplete="organization"
            value={orgName}
            onChange={(event) => setOrgName(event.target.value)}
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Work Email
          </label>
          <input
            id="email"
            type="email"
            className={styles.input}
            placeholder="you@company.com"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

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
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className={styles.footerText}>
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </div>
  );
}
