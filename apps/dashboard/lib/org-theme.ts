import type { CSSProperties } from "react";
import type { AuthOrg } from "./api-client";

// The product's own default accent pair — every tokens.module.css in this
// app (sessions/voice-ai/(dashboard) under the "--vc-*" prefix, onboarding
// under its own "--ob-*" prefix, see onboarding/tokens.module.css's doc
// comment on why it's a separate copy) hardcodes these same two hex values
// today. Kept here so an org that never sets branding computes the exact
// same gradient the CSS already hardcodes, not a second source of truth.
const DEFAULT_PRIMARY = "#8b5cf6";
const DEFAULT_SECONDARY = "#3b82f6";

/**
 * Inline CSS custom-property overrides for a tokens root, so a tenant's
 * brand colors retint every consumer of the --vc-accent-* and --ob-accent-*
 * vars (nav highlights, buttons, gradients, badges) with no per-component
 * rewrites.
 *
 * Both "--vc-*" and "--ob-*" variants are always emitted together — some
 * routes use one prefix, some the other (see the doc comment above), and an
 * unused custom property is simply ignored by the browser, so one style
 * object is safe to spread on any of this app's four tokens roots.
 *
 * --vc-accent-gradient/--ob-accent-gradient are their OWN hardcoded
 * variables in every tokens.module.css, not derived from the violet/blue
 * vars via CSS — so they must be computed and overridden explicitly here,
 * or every gradient-background element (buttons, avatar badges, session
 * cards) would silently stay on the default purple/blue regardless of the
 * org's chosen colors. See .claude/specs/tenant-branding.md's UI Changes.
 */
export function orgAccentStyle(org: AuthOrg | null | undefined): CSSProperties {
  if (!org?.primaryColorHex && !org?.secondaryColorHex) return {};

  const primary = org.primaryColorHex ?? DEFAULT_PRIMARY;
  const secondary = org.secondaryColorHex ?? DEFAULT_SECONDARY;
  const gradient = `linear-gradient(90deg, ${primary}, ${secondary})`;

  return {
    "--vc-accent-violet": primary,
    "--vc-accent-blue": secondary,
    "--vc-accent-gradient": gradient,
    "--ob-accent-violet": primary,
    "--ob-accent-blue": secondary,
    "--ob-accent-gradient": gradient,
  } as CSSProperties;
}
