"use client";

import { useState, type FormEvent } from "react";
import { login, postLoginRedirectTarget } from "../../lib/api-client";
import styles from "./page.module.css";
import {
  ArrowRightIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  GoogleIcon,
  LightningIcon,
  MicrosoftIcon,
  ShieldIcon,
  UsersIcon,
} from "./icons";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await login(email, password);
      window.location.assign(postLoginRedirectTarget(result.user));
    } catch {
      // Never distinguish wrong password from unknown email in the UI —
      // apps/api's /v1/auth/login already returns an identical 401 for both.
      setError("Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.authInner}>
      <span className={styles.badge}>
        <ShieldIcon />
        Enterprise secure login
      </span>

      <h1 className={styles.title}>Welcome back 👋</h1>
      <p className={styles.subtitle}>Sign in to your enterprise learning account</p>

      <div className={styles.oauthRow}>
        <a href="/api/auth/google" className={styles.oauthButton}>
          <GoogleIcon />
          Continue with Google
        </a>
        <button type="button" className={styles.oauthButton}>
          <MicrosoftIcon />
          Continue with Microsoft
        </button>
      </div>

      <div className={styles.divider}>or sign in with email</div>

      <form onSubmit={handleSubmit} noValidate>
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
          <div className={styles.fieldRow}>
            <label className={styles.label} htmlFor="password">
              Password
            </label>
            <button type="button" className={styles.link}>
              Forgot password?
            </button>
          </div>
          <div className={styles.passwordWrap}>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              className={styles.input}
              placeholder="Enter your password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              type="button"
              className={styles.eyeButton}
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>

        <div className={styles.checkboxRow}>
          <button
            type="button"
            className={styles.checkbox}
            data-checked={keepSignedIn}
            role="checkbox"
            aria-checked={keepSignedIn}
            aria-label="Keep me signed in for 30 days"
            onClick={() => setKeepSignedIn((value) => !value)}
          >
            {keepSignedIn && <CheckIcon />}
          </button>
          <span className={styles.checkboxLabel}>Keep me signed in for 30 days</span>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.submit} disabled={submitting}>
          <LightningIcon />
          {submitting ? "Signing in…" : "Sign In to AI Nancy"}
          <ArrowRightIcon />
        </button>
      </form>

      <div className={styles.trustRow}>
        <span className={styles.trustItem}>
          <ShieldIcon />
          SSO Ready
        </span>
        <span className={styles.trustItem}>
          <UsersIcon />
          500K+ Users
        </span>
        <span className={styles.trustItem}>
          <LightningIcon />
          99.9% Uptime
        </span>
      </div>

      <div className={styles.footerDivider} />

      <p className={styles.footerText}>
        By signing in you agree to our <a href="/terms">Terms</a>,{" "}
        <a href="/privacy">Privacy Policy</a> &amp; <a href="/cookies">Cookie Policy</a>
      </p>
      <p className={styles.footerNote}>
        Need access? <a href="mailto:admin@avatrain.com">Contact your admin</a>
      </p>
    </div>
  );
}
