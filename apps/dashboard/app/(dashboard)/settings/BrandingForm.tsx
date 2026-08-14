"use client";

import { useState, type FormEvent } from "react";
import { updateOrgBranding, type AuthOrg } from "../../../lib/api-client";
import { useTranslation } from "../../../lib/locale/LocaleProvider";
import styles from "./page.module.css";

export interface BrandingFormProps {
  initialOrg: AuthOrg;
}

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_PRIMARY = "#8B5CF6";
const DEFAULT_SECONDARY = "#3B82F6";

export function BrandingForm({ initialOrg }: BrandingFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialOrg.name);
  const [logoUrl, setLogoUrl] = useState(initialOrg.logoUrl ?? "");
  const [primaryColorHex, setPrimaryColorHex] = useState(initialOrg.primaryColorHex ?? DEFAULT_PRIMARY);
  const [secondaryColorHex, setSecondaryColorHex] = useState(
    initialOrg.secondaryColorHex ?? DEFAULT_SECONDARY,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await updateOrgBranding({
        name: name.trim(),
        // An empty string isn't a valid URL — omit the field entirely
        // rather than send one, so a never-set logo stays never-set instead
        // of 400ing the whole request.
        logoUrl: logoUrl.trim() || undefined,
        primaryColorHex,
        secondaryColorHex,
      });
      // The Sidebar/tokens root are server-rendered from getMe() one layer
      // up in the layout — no client-side org store exists to patch in
      // place yet, so a full reload is the simplest way to reflect the
      // change immediately.
      window.location.reload();
    } catch {
      setError(t("brandingForm.saveError"));
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="org-name">
          {t("brandingForm.orgNameLabel")}
        </label>
        <input
          id="org-name"
          type="text"
          className={styles.input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          minLength={1}
          maxLength={200}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="org-logo">
          {t("brandingForm.logoUrlLabel")}
        </label>
        <input
          id="org-logo"
          type="url"
          className={styles.input}
          placeholder="https://cdn.example.com/logo.png"
          value={logoUrl}
          onChange={(event) => setLogoUrl(event.target.value)}
        />
      </div>

      <div className={styles.colorRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="org-primary-color">
            {t("brandingForm.primaryColorLabel")}
          </label>
          <div className={styles.colorInputWrap}>
            <input
              type="color"
              aria-label={t("brandingForm.primaryColorPickerAriaLabel")}
              className={styles.colorSwatch}
              value={HEX_COLOR_PATTERN.test(primaryColorHex) ? primaryColorHex : DEFAULT_PRIMARY}
              onChange={(event) => setPrimaryColorHex(event.target.value)}
            />
            <input
              id="org-primary-color"
              type="text"
              className={styles.input}
              value={primaryColorHex}
              onChange={(event) => setPrimaryColorHex(event.target.value)}
              pattern="^#[0-9A-Fa-f]{6}$"
              required
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="org-secondary-color">
            {t("brandingForm.secondaryColorLabel")}
          </label>
          <div className={styles.colorInputWrap}>
            <input
              type="color"
              aria-label={t("brandingForm.secondaryColorPickerAriaLabel")}
              className={styles.colorSwatch}
              value={HEX_COLOR_PATTERN.test(secondaryColorHex) ? secondaryColorHex : DEFAULT_SECONDARY}
              onChange={(event) => setSecondaryColorHex(event.target.value)}
            />
            <input
              id="org-secondary-color"
              type="text"
              className={styles.input}
              value={secondaryColorHex}
              onChange={(event) => setSecondaryColorHex(event.target.value)}
              pattern="^#[0-9A-Fa-f]{6}$"
              required
            />
          </div>
        </div>
      </div>

      <div
        className={styles.preview}
        style={{ background: `linear-gradient(90deg, ${primaryColorHex}, ${secondaryColorHex})` }}
      />

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <button type="submit" className={styles.submit} disabled={submitting}>
        {submitting ? t("brandingForm.saving") : t("brandingForm.saveChanges")}
      </button>
    </form>
  );
}
