"use client";

import { useState, type FormEvent } from "react";
import { ApiError, postLoginRedirectTarget, signup } from "../../lib/api-client";
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
} from "../_auth/icons";

export function SignupForm() {
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agreedToTerms) return;

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
    <div className={styles.authInner}>
      <span className={styles.badge}>
        <ShieldIcon />
        Secure enterprise signup
      </span>

      <h1 className={styles.title}>Create your account 🚀</h1>
      <p className={styles.subtitle}>Set up your organization and start training with AI avatars</p>

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

      <div className={styles.divider}>or sign up with email</div>

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
          <div className={styles.passwordWrap}>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              className={styles.input}
              placeholder="Create a password"
              autoComplete="new-password"
              minLength={8}
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
          <p className={styles.hint}>At least 8 characters</p>
        </div>

        <div className={styles.checkboxRow}>
          <button
            type="button"
            className={styles.checkbox}
            data-checked={agreedToTerms}
            role="checkbox"
            aria-checked={agreedToTerms}
            aria-label="I agree to the Terms of Service and Privacy Policy"
            onClick={() => setAgreedToTerms((value) => !value)}
          >
            {agreedToTerms && <CheckIcon />}
          </button>
          <span className={styles.checkboxLabel}>
            I agree to the <a href="/terms">Terms of Service</a> and{" "}
            <a href="/privacy">Privacy Policy</a>
          </span>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.submit} disabled={submitting || !agreedToTerms}>
          <LightningIcon />
          {submitting ? "Creating account…" : "Create Account"}
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
        By creating an account you agree to our <a href="/terms">Terms</a>,{" "}
        <a href="/privacy">Privacy Policy</a> &amp; <a href="/cookies">Cookie Policy</a>
      </p>
      <p className={styles.footerNote}>
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </div>
  );
}
