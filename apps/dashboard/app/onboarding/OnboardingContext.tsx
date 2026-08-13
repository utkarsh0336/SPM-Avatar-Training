"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { createAvatarProviderFromEnv, resolveReplicaId, SKIN_TONE_HEX, HAIR_COLOR_HEX } from "@avatrain/avatar-core";
// Sub-path import — see api-client.ts's comment on why the root
// "@avatrain/shared" barrel must never be imported from client code.
import type { OnboardingDraftInput, OnboardingDraftResponse } from "@avatrain/shared/onboarding";
import { ApiError, getOnboardingDraft, mintSimliSession, patchOnboardingDraft } from "../../lib/api-client";
import { INITIAL_ONBOARDING_STATE, type OnboardingState } from "./types";

export type LiveAvatarStatus = "idle" | "connecting" | "connected" | "error";

export interface LiveAvatarHandle {
  /**
   * A single persistent DOM node the live avatar's video/canvas/audio
   * elements are mounted into once (a Simli <video>, a VRM <canvas>, or a
   * Mock <video>, depending on NEXT_PUBLIC_AVATAR_PROVIDER) — owned here, at
   * the stable outer /onboarding/layout.tsx level, and moved (not recreated)
   * into whichever step's AvatarPreviewPanel currently wants to display it.
   * See AvatarPreviewPanel.tsx's doc comment for why:
   * /onboarding/[step]/layout.tsx remounts on every step change (its own
   * path includes the [step] dynamic segment), so anything created inside
   * it — including a WebRTC connection or a Three.js scene — would
   * otherwise reconnect/rebuild on every Continue/Back click. Moving an
   * already-attached DOM node via appendChild() relocates it without
   * tearing down its live stream/render loop.
   */
  containerElement: HTMLDivElement;
  status: LiveAvatarStatus;
}

interface OnboardingContextValue {
  state: OnboardingState;
  update: (patch: Partial<OnboardingState>) => void;
  /** Sends any pending debounced autosave immediately. See VoiceReviewStep.tsx. */
  flush: () => Promise<void>;
  /** null until hydration resolves and the connection effect below has created its container — see AvatarPreviewPanel.tsx. Populated for every NEXT_PUBLIC_AVATAR_PROVIDER value (default "vrm", opt-in "simli"/"mock"). */
  liveAvatar: LiveAvatarHandle | null;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

// Per .claude/specs/onboarding.md's State Management: every field change
// triggers a debounced PATCH autosave so state survives a refresh mid-step,
// not just between steps. A lost unsaved field on an untimely refresh before
// this fires is an accepted risk (onboarding.md Implementation Assumptions
// #4), not something this debounce tries to eliminate.
const AUTOSAVE_DEBOUNCE_MS = 500;

// Server values are nullable (unset); client defaults (INITIAL_ONBOARDING_STATE)
// are sensible non-null placeholders so the live preview never looks blank.
// A server-known value always wins over the client default; an unset server
// field falls back to whatever the client currently holds — see the
// "concurrent edit during hydration" note below for the one accepted race
// this leaves.
export function mergeDraftIntoState(prev: OnboardingState, draft: OnboardingDraftResponse): OnboardingState {
  return {
    style: draft.style ?? prev.style,
    gender: draft.gender ?? prev.gender,
    skinTone: draft.skinTone ?? prev.skinTone,
    hairStyle: draft.hairStyle ?? prev.hairStyle,
    hairColor: draft.hairColor ?? prev.hairColor,
    outfit: draft.outfit ?? prev.outfit,
    name: draft.name ?? prev.name,
    expertise: draft.expertise ?? prev.expertise,
    voice: draft.voice ?? prev.voice,
    previewProvider: draft.previewProvider,
    externalAvatarId: draft.externalAvatarId,
    avatarModelUrl: draft.avatarModelUrl,
    avatarSnapshotUrl: draft.avatarSnapshotUrl,
    simliFaceId: draft.simliFaceId,
  };
}

// Builds only the subset of state that's currently valid to send — an empty
// or too-short name (the field's default until Step 5) or a null style (the
// default until Step 1) would otherwise fail the server's Zod validation on
// every autosave tick before the user has actually reached that step.
export function buildPatchPayload(state: OnboardingState): OnboardingDraftInput {
  const payload: OnboardingDraftInput = {
    gender: state.gender,
    skinTone: state.skinTone as OnboardingDraftInput["skinTone"],
    hairStyle: state.hairStyle,
    hairColor: state.hairColor as OnboardingDraftInput["hairColor"],
    outfit: state.outfit,
    expertise: state.expertise,
    voice: state.voice,
  };
  if (state.style) payload.style = state.style;
  if (state.name.trim().length >= 2) payload.name = state.name;
  if (state.previewProvider !== "NONE") {
    payload.previewProvider = state.previewProvider;
    if (state.externalAvatarId) payload.externalAvatarId = state.externalAvatarId;
    if (state.avatarModelUrl) payload.avatarModelUrl = state.avatarModelUrl;
    if (state.avatarSnapshotUrl) payload.avatarSnapshotUrl = state.avatarSnapshotUrl;
  }
  return payload;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OnboardingState>(INITIAL_ONBOARDING_STATE);
  const hydratedRef = useRef(false);
  // Mirrors hydratedRef as state (refs aren't valid effect deps) — the live
  // avatar connection effect gates on this so it never connects using
  // INITIAL_ONBOARDING_STATE's client-default gender before the real
  // server-known gender (if any) has loaded. See that effect's doc comment.
  const [hydrated, setHydrated] = useState(false);
  const skipNextAutosaveRef = useRef(false);
  const debounceHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<OnboardingDraftInput | null>(null);
  const router = useRouter();

  const [liveAvatarStatus, setLiveAvatarStatus] = useState<LiveAvatarStatus>("idle");
  // Populated only inside the effect below, never during render — creating
  // it inline in the render body (gated on `typeof document`) previously
  // caused a hydration mismatch: SSR has no `document` so the server always
  // renders liveAvatar as null, but the client's first render pass DOES
  // have `document`, so that inline check would make the client's very
  // first render disagree with the server's. React's hydration-mismatch
  // recovery then discards and rebuilds the whole subtree, which tore down
  // the just-established WebRTC connection (reproduced during manual
  // verification — the live video went black after any full navigation).
  // A ref populated only in an effect guarantees the first client render
  // matches the server (both null) — effects never run during SSR.
  const liveAvatarContainerRef = useRef<HTMLDivElement | null>(null);
  const [liveAvatarContainerReady, setLiveAvatarContainerReady] = useState(false);

  const flush = useCallback((): Promise<void> => {
    if (debounceHandleRef.current) {
      clearTimeout(debounceHandleRef.current);
      debounceHandleRef.current = null;
    }
    const payload = pendingPatchRef.current;
    pendingPatchRef.current = null;
    if (!payload) return Promise.resolve();
    return patchOnboardingDraft(payload)
      .then(() => undefined)
      .catch((err) => {
        console.error("[OnboardingContext] autosave failed:", err);
      });
  }, []);

  // Connects once hydration resolves (never before — connecting with
  // INITIAL_ONBOARDING_STATE's client-default gender first, then
  // reconnecting again once the real server-known gender loads, would waste
  // a Simli session and flash the wrong face) and RECONNECTS whenever
  // style/gender/outfit change — together these pick which real face/model
  // loads for every provider: Simli resolves its face server-side from
  // gender alone (SIMLI_FACE_ID_FEMALE/MALE/NEUTRAL; it never reads the
  // replicaId this effect passes), while the default VRM provider resolves
  // one of a small curated set of replicas from all three
  // (resolveReplicaId() in packages/avatar-core/src/replica-resolver.ts).
  // skinTone/hairColor deliberately do NOT trigger a reconnect here — VRM
  // applies them as a material tint at connect time (so they're still
  // correct on the initial connect and on any style/gender/outfit-triggered
  // reconnect), but a full reconnect on every color-swatch click would
  // flicker for no benefit; LivePreviewPanel's lightweight preview renderer
  // already gives instant feedback for those two fields specifically.
  //
  // Persists gender via its OWN targeted PATCH {gender} before minting,
  // rather than the generic flush()/pendingPatchRef machinery the debounced
  // autosave effect (below) uses. Both effects re-run in the same commit
  // when state.gender changes, but this one is defined first, so calling
  // the shared flush() here would race the autosave effect's own write to
  // pendingPatchRef and could flush a stale (pre-gender-change) payload or
  // nothing at all — reproduced during manual verification: a gender switch
  // reconnected in time but rendered the PREVIOUS gender's face because
  // POST /v1/conversations/simli-session's getCallerSimliFaceId read the
  // Avatar row before the real PATCH landed. A patch scoped to just
  // {gender}, awaited directly in this effect, has no dependency on the
  // other effect's timing. Unconditional even when this run was triggered
  // by a style/outfit change (not gender) — it's a cheap idempotent no-op
  // in that case, and keeping one reconnect path simple beats special-casing
  // which field changed.
  //
  // Reuses the same persistent container DOM node across reconnects
  // (created once, never recreated) — see LiveAvatarHandle's doc comment
  // for why AvatarPreviewPanel depends on that node's identity staying
  // stable across [step] layout remounts. Safe even if a fast second
  // reconnect-triggering change fires before the first reconnect finishes:
  // SimliAvatarProvider's own internal `stopped` guard (see
  // packages/avatar-core/src/simli-avatar-provider.ts) makes a stale
  // provider's start() no-op instead of touching a torn-down container.
  useEffect(() => {
    if (!hydrated) return;

    if (!liveAvatarContainerRef.current) {
      const el = document.createElement("div");
      el.style.width = "100%";
      el.style.height = "100%";
      liveAvatarContainerRef.current = el;
      setLiveAvatarContainerReady(true);
    }
    const container = liveAvatarContainerRef.current;

    let cancelled = false;
    setLiveAvatarStatus("connecting");

    // "REALISTIC" fallback matches useConversationSession.ts's own
    // DEFAULT_PERSONA.style — covers the window before Step 1 sets a real
    // style. resolveReplicaId is pure and never throws (nearest-match
    // fallback chain down to the registry default), and is ignored by Simli
    // (gender-only face selection) and harmless for Mock.
    const replicaId = resolveReplicaId({
      style: state.style ?? "REALISTIC",
      gender: state.gender,
      outfit: state.outfit,
    });

    const provider = createAvatarProviderFromEnv({
      env: { NEXT_PUBLIC_AVATAR_PROVIDER: process.env.NEXT_PUBLIC_AVATAR_PROVIDER },
      getSimliSessionCredentials: mintSimliSession,
      skinToneHex: SKIN_TONE_HEX[state.skinTone] ?? null,
      hairColorHex: HAIR_COLOR_HEX[state.hairColor] ?? null,
    });

    void patchOnboardingDraft({ gender: state.gender })
      .catch((err) => {
        console.error("[OnboardingContext] failed to persist gender before reconnect:", err);
      })
      .then(() =>
        provider
          .start({ replicaId, container })
          .then(() => {
            if (!cancelled) setLiveAvatarStatus("connected");
          })
          .catch((err) => {
            console.error("[OnboardingContext] failed to connect live avatar preview:", err);
            if (!cancelled) setLiveAvatarStatus("error");
          }),
      );

    return () => {
      cancelled = true;
      provider.stop();
    };
  }, [hydrated, state.style, state.gender, state.outfit]);

  // Hydrate once on mount — the server draft becomes the source of truth
  // across reloads/devices; this component's state is a working copy for
  // the current tab. 409 draft_already_completed means the caller already
  // finished onboarding (e.g. a direct URL revisit) — onboarding is a
  // one-time gate, not a re-enterable editor (onboarding.md's Navigation
  // Behavior), so this redirects away rather than leaving a stale wizard
  // visible. Any other hydration failure falls back to client-only defaults
  // instead of blocking the wizard from rendering — POST /complete's
  // server-side re-validation is the actual enforcement point regardless.
  useEffect(() => {
    let cancelled = false;
    getOnboardingDraft()
      .then((draft) => {
        if (cancelled) return;
        skipNextAutosaveRef.current = true;
        setState((prev) => mergeDraftIntoState(prev, draft));
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.body.error === "draft_already_completed") {
          router.replace("/sessions");
          return;
        }
        console.error("[OnboardingContext] failed to hydrate draft:", err);
      })
      .finally(() => {
        if (!cancelled) {
          hydratedRef.current = true;
          setHydrated(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Debounced autosave — skipped entirely until hydration resolves (so a
  // burst of pre-hydration updates() doesn't race the initial GET), and
  // skipped once more for the single state change hydration itself causes.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    pendingPatchRef.current = buildPatchPayload(state);
    if (debounceHandleRef.current) clearTimeout(debounceHandleRef.current);
    debounceHandleRef.current = setTimeout(() => {
      debounceHandleRef.current = null;
      void flush();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceHandleRef.current) {
        clearTimeout(debounceHandleRef.current);
        debounceHandleRef.current = null;
      }
    };
  }, [state, flush]);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      state,
      update: (patch) => setState((prev) => ({ ...prev, ...patch })),
      flush,
      liveAvatar:
        liveAvatarContainerReady && liveAvatarContainerRef.current
          ? { containerElement: liveAvatarContainerRef.current, status: liveAvatarStatus }
          : null,
    }),
    [state, flush, liveAvatarContainerReady, liveAvatarStatus],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return ctx;
}
