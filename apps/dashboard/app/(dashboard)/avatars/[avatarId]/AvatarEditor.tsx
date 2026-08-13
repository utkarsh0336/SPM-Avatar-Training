"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createVrmAvatarPreviewRenderer, type AvatarPreviewConfig, type AvatarPreviewRenderer } from "@avatrain/avatar-core";
import type { AvatarRecord } from "@avatrain/shared/avatar";
import type { OnboardingDraftInput } from "@avatrain/shared/onboarding";
import { ApiError, archiveAvatar, getAvatar, publishAvatar, updateAvatar } from "../../../../lib/api-client";
import { SelectionCard } from "../../../onboarding/SelectionCard";
import { PhotoOptionCard } from "../../../onboarding/PhotoOptionCard";
import { SwatchPicker } from "../../../onboarding/SwatchPicker";
import { PillPicker } from "../../../onboarding/PillPicker";
import { RowOptionCard } from "../../../onboarding/RowOptionCard";
import { CameraIcon, CubeIcon, PaletteIcon, BriefcaseIcon, CoffeeIcon, GraduationCapIcon, LaptopIcon, LayersIcon, type IconComponent } from "../../../onboarding/icons";
import {
  EXPERTISE_LABELS,
  GENDER_GRADIENTS,
  GENDER_LABELS,
  GENDER_PHOTOS,
  HAIR_COLOR_OPTIONS,
  HAIR_COLOR_SWATCHES,
  HAIR_STYLE_LABELS,
  OUTFIT_GRADIENTS,
  OUTFIT_SUBTITLES,
  OUTFIT_TITLES,
  SKIN_TONE_OPTIONS,
  SKIN_TONE_SWATCHES,
  STYLE_PREVIEW_PHOTOS,
  VOICE_LABELS,
  type AvatarStyle,
  type Expertise,
  type Gender,
  type HairStyle,
  type Outfit,
  type VoiceTone,
} from "../../../onboarding/types";
import styles from "./AvatarEditor.module.css";

const STYLE_OPTIONS: { value: AvatarStyle; title: string; subtitle: string; Icon: IconComponent }[] = [
  { value: "REALISTIC", title: "Realistic", subtitle: "Photo-realistic AI avatar", Icon: CameraIcon },
  { value: "ANIMATED", title: "Animated", subtitle: "Illustrated 2D style", Icon: PaletteIcon },
  { value: "STYLIZED_3D", title: "3D Stylized", subtitle: "Rendered 3D character", Icon: CubeIcon },
];
const GENDER_OPTIONS: Gender[] = ["FEMALE", "MALE", "NEUTRAL"];
const HAIR_STYLE_OPTIONS: readonly HairStyle[] = ["SHORT", "MEDIUM", "LONG", "CURLY", "WAVY", "BALD"];
const OUTFIT_OPTIONS: { value: Outfit; Icon: IconComponent }[] = [
  { value: "BUSINESS_FORMAL", Icon: BriefcaseIcon },
  { value: "BUSINESS_CASUAL", Icon: CoffeeIcon },
  { value: "SMART_PROFESSIONAL", Icon: LayersIcon },
  { value: "TECH_CREATIVE", Icon: LaptopIcon },
  { value: "ACADEMIC_EDUCATOR", Icon: GraduationCapIcon },
];
const EXPERTISE_OPTIONS: readonly Expertise[] = [
  "HR_LEAVE_POLICY",
  "SALES_NEGOTIATION",
  "COMPLIANCE_LEGAL",
  "PRODUCT_TRAINING",
  "CUSTOMER_SUPPORT",
  "LEADERSHIP_MANAGEMENT",
  "FINANCE_ACCOUNTING",
  "IT_TECHNOLOGY",
  "MARKETING_BRANDING",
];
const VOICE_OPTIONS: readonly VoiceTone[] = ["DEEP", "NEUTRAL", "WARM"];

interface EditorFormState {
  name: string;
  style: AvatarStyle;
  gender: Gender;
  skinTone: string;
  hairStyle: HairStyle;
  hairColor: string;
  outfit: Outfit;
  expertise: Expertise;
  voice: VoiceTone;
}

const DEFAULTS: EditorFormState = {
  name: "",
  style: "REALISTIC",
  gender: "FEMALE",
  skinTone: "TONE_2",
  hairStyle: "MEDIUM",
  hairColor: "AUBURN",
  outfit: "BUSINESS_FORMAL",
  expertise: "HR_LEAVE_POLICY",
  voice: "NEUTRAL",
};

// A DRAFT avatar can have every customization field still null — backfills
// each with the same defaults the onboarding wizard itself starts from
// (INITIAL_ONBOARDING_STATE), so the form (and every picker below, which
// all require a non-null `selected`) always has something coherent to show.
function toFormState(avatar: AvatarRecord): EditorFormState {
  return {
    name: avatar.name ?? "",
    style: avatar.style ?? DEFAULTS.style,
    gender: avatar.gender ?? DEFAULTS.gender,
    skinTone: avatar.skinTone ?? DEFAULTS.skinTone,
    hairStyle: avatar.hairStyle ?? DEFAULTS.hairStyle,
    hairColor: avatar.hairColor ?? DEFAULTS.hairColor,
    outfit: avatar.outfit ?? DEFAULTS.outfit,
    expertise: avatar.expertise ?? DEFAULTS.expertise,
    voice: avatar.voice ?? DEFAULTS.voice,
  };
}

// Cast, not a validation — form.skinTone/hairColor are plain `string`
// (matches AppearanceStep.tsx's own state shape), wider than
// OnboardingDraftInput's schema-derived literal union. Same convention as
// OnboardingContext.tsx's buildPatchPayload; the server's
// onboardingDraftSchema.parse() is what actually enforces the allowlist.
function toPatchInput(form: EditorFormState): OnboardingDraftInput {
  return {
    ...form,
    skinTone: form.skinTone as OnboardingDraftInput["skinTone"],
    hairColor: form.hairColor as OnboardingDraftInput["hairColor"],
  };
}

interface AvatarEditorProps {
  avatarId: string;
}

/**
 * Single-page persona editor — deliberately not a re-run of onboarding's
 * 6-step wizard flow (that's a first-time, guided experience; editing one
 * of several already-created personas is a return visit where an OWNER
 * wants to see and change everything at once). Reuses the wizard's own
 * presentational pickers directly (SelectionCard, PhotoOptionCard,
 * SwatchPicker, PillPicker, RowOptionCard) — they were already decoupled
 * from OnboardingContext, so no extraction was needed to reuse them here.
 */
export function AvatarEditor({ avatarId }: AvatarEditorProps) {
  const router = useRouter();
  const [avatar, setAvatar] = useState<AvatarRecord | null>(null);
  const [form, setForm] = useState<EditorFormState>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewRendererRef = useRef<AvatarPreviewRenderer | null>(null);
  const previewMountedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getAvatar(avatarId).then(
      (result) => {
        if (cancelled) return;
        setAvatar(result);
        setForm(toFormState(result));
      },
      () => {
        if (!cancelled) setError("Could not load this persona.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [avatarId]);

  function update<K extends keyof EditorFormState>(key: K, value: EditorFormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  const previewConfig: AvatarPreviewConfig = {
    style: form.style,
    gender: form.gender,
    skinTone: form.skinTone,
    hairStyle: form.hairStyle,
    hairColor: form.hairColor,
    outfit: form.outfit,
    previewProvider: "NONE",
    avatarModelUrl: null,
    avatarSnapshotUrl: null,
  };

  useEffect(() => {
    if (!avatar) return; // wait for the initial fetch — avoids a flash render of the DEFAULTS persona
    const container = previewContainerRef.current;
    if (!container) return;
    const renderer = createVrmAvatarPreviewRenderer();
    previewRendererRef.current = renderer;
    void renderer.render(previewConfig, container);
    return () => {
      renderer.destroy();
      previewRendererRef.current = null;
      previewMountedRef.current = true; // next mount's update effect should skip its first run too
    };
    // Deliberately [avatar]: mounts once the fetch resolves, not on every form change.
  }, [avatar]);

  useEffect(() => {
    if (!previewMountedRef.current) {
      previewMountedRef.current = true;
      return;
    }
    previewRendererRef.current?.update(previewConfig);
    // Deliberately the individual form.* fields, not previewConfig itself (a fresh object every render).
  }, [form.style, form.gender, form.skinTone, form.hairStyle, form.hairColor, form.outfit]);

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAvatar(avatarId, toPatchInput(form));
      setAvatar(updated);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? (err.body.message ?? "Could not save changes.") : "Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await updateAvatar(avatarId, toPatchInput(form));
      const published = await publishAvatar(avatarId);
      setAvatar(published);
      setSavedAt(Date.now());
    } catch (err) {
      const fields = err instanceof ApiError ? err.body.fields : undefined;
      const detail = fields?.length ? ` Missing: ${fields.map((f) => f.path).join(", ")}.` : "";
      setError(
        err instanceof ApiError ? `${err.body.message ?? "Could not publish."}${detail}` : "Could not reach the server.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const archived = await archiveAvatar(avatarId);
      setAvatar(archived);
    } catch (err) {
      setError(err instanceof ApiError ? (err.body.message ?? "Could not archive.") : "Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  if (!avatar) return null;

  return (
    <div className={styles.layout}>
      <div className={styles.previewColumn}>
        <button type="button" className={styles.backLink} onClick={() => router.push("/avatars")}>
          ← Back to Avatars
        </button>
        <span className={styles.statusBadge}>{avatar.status}</span>
        <div className={styles.previewCard} ref={previewContainerRef} />
      </div>

      <div className={styles.formColumn}>
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.section}>
          <span className={styles.sectionLabel}>NAME</span>
          <input
            className={styles.nameInput}
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
            placeholder="e.g. Alex, Jordan, Priya…"
            maxLength={60}
          />
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>STYLE</span>
          <div className={styles.grid3}>
            {STYLE_OPTIONS.map((option) => (
              <SelectionCard
                key={option.value}
                title={option.title}
                subtitle={option.subtitle}
                icon={<option.Icon size={16} />}
                thumbnailIcon={<option.Icon size={28} />}
                thumbnailPhotoUrl={option.value === "REALISTIC" ? GENDER_PHOTOS[form.gender] : STYLE_PREVIEW_PHOTOS[option.value]}
                selected={form.style === option.value}
                onSelect={() => update("style", option.value)}
              />
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>GENDER</span>
          <div className={styles.grid3}>
            {GENDER_OPTIONS.map((option) => (
              <PhotoOptionCard
                key={option}
                label={GENDER_LABELS[option]}
                gradient={GENDER_GRADIENTS[option]}
                photoUrl={GENDER_PHOTOS[option]}
                selected={form.gender === option}
                onSelect={() => update("gender", option)}
              />
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>SKIN TONE</span>
          <SwatchPicker
            options={SKIN_TONE_OPTIONS}
            colors={SKIN_TONE_SWATCHES}
            selected={form.skinTone}
            onSelect={(value) => update("skinTone", value)}
          />
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>HAIR STYLE</span>
          <PillPicker
            options={HAIR_STYLE_OPTIONS}
            labels={HAIR_STYLE_LABELS}
            selected={form.hairStyle}
            onSelect={(value) => update("hairStyle", value)}
          />
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>HAIR COLOR</span>
          <SwatchPicker
            options={HAIR_COLOR_OPTIONS}
            colors={HAIR_COLOR_SWATCHES}
            selected={form.hairColor}
            onSelect={(value) => update("hairColor", value)}
          />
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>OUTFIT</span>
          {OUTFIT_OPTIONS.map((option) => (
            <RowOptionCard
              key={option.value}
              title={OUTFIT_TITLES[option.value]}
              subtitle={OUTFIT_SUBTITLES[option.value]}
              gradient={OUTFIT_GRADIENTS[option.value]}
              photoUrl={GENDER_PHOTOS[form.gender]}
              icon={<option.Icon size={18} />}
              selected={form.outfit === option.value}
              onSelect={() => update("outfit", option.value)}
            />
          ))}
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>EXPERTISE</span>
          <PillPicker
            options={EXPERTISE_OPTIONS}
            labels={EXPERTISE_LABELS}
            selected={form.expertise}
            onSelect={(value) => update("expertise", value)}
          />
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>VOICE</span>
          <PillPicker options={VOICE_OPTIONS} labels={VOICE_LABELS} selected={form.voice} onSelect={(value) => update("voice", value)} />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.saveButton} onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {avatar.status !== "ACTIVE" && (
            <button type="button" className={styles.secondaryButton} onClick={() => void handlePublish()} disabled={saving}>
              Publish
            </button>
          )}
          {avatar.status !== "ARCHIVED" && (
            <button type="button" className={styles.secondaryButton} onClick={() => void handleArchive()} disabled={saving}>
              Archive
            </button>
          )}
          {savedAt && <span className={styles.savedNote}>Saved</span>}
        </div>
      </div>
    </div>
  );
}
