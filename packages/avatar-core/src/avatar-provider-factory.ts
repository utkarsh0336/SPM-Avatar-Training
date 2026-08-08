import type { AvatarProvider } from "./index.js";
import { createMockAvatarProvider } from "./mock-avatar-provider.js";
import { createSimliAvatarProvider, type SimliSessionCredentials } from "./simli-avatar-provider.js";

export type AvatarProviderName = "mock" | "simli";

export interface CreateAvatarProviderFromEnvOptions {
  /**
   * Must be passed explicitly by the caller as a literal
   * `{ NEXT_PUBLIC_AVATAR_PROVIDER: process.env.NEXT_PUBLIC_AVATAR_PROVIDER }`
   * expression written directly in a Next.js-processed file (e.g.
   * useConversationSession.ts) — Next only inlines `process.env.NEXT_PUBLIC_*`
   * for that exact static expression pattern at build time, not for a
   * dynamic property access through a variable, so this package cannot read
   * it itself (there is no real `process` global in the browser bundle).
   * Defaults to {} (resolves to "mock") when omitted, e.g. in this
   * package's own Node-based tests.
   */
  env?: Record<string, string | undefined>;
  onSubtitleChange?: (text: string) => void;
  onAmplitudeChange?: (amplitude: number) => void;
  /**
   * Required when the resolved provider is "simli" — resolves server-minted
   * session credentials (e.g. mintSimliSession() in
   * apps/dashboard/lib/api-client.ts).
   */
  getSimliSessionCredentials?: () => Promise<SimliSessionCredentials>;
  createVideoElement?: () => HTMLVideoElement;
  createAudioElement?: () => HTMLAudioElement;
}

/**
 * NEXT_PUBLIC_AVATAR_PROVIDER picks the provider — default "mock" (the $0
 * idle-video fallback), opt-in "simli" (paid, real lip-synced video).
 * Mirrors packages/shared's LLM_PROVIDER/TTS_PROVIDER env-driven factory
 * convention, but lives in packages/avatar-core rather than packages/shared
 * since both providers are browser-DOM-only and carry no secrets — same
 * reasoning packages/shared/src/providers/types.ts already documents for why
 * AvatarProvider itself isn't declared there. See
 * .claude/specs/avatar-builder-customization.md and
 * .claude/specs/ai-avatar.md §4 ("providers are selected by env var").
 *
 * Simli's amplitude-reactive UI cue is deliberately not simulated here —
 * that indicator exists to signal "something is happening" over Mock's
 * static idle video; Simli's own video already shows real mouth movement,
 * so onAmplitudeChange simply never fires while it's the active provider.
 */
export function createAvatarProviderFromEnv(
  options: CreateAvatarProviderFromEnvOptions = {},
): AvatarProvider {
  const env = options.env ?? {};
  const name: AvatarProviderName = env.NEXT_PUBLIC_AVATAR_PROVIDER === "simli" ? "simli" : "mock";

  if (name === "simli") {
    if (!options.getSimliSessionCredentials) {
      throw new Error(
        "NEXT_PUBLIC_AVATAR_PROVIDER=simli requires getSimliSessionCredentials to be supplied.",
      );
    }
    return createSimliAvatarProvider({
      getSessionCredentials: options.getSimliSessionCredentials,
      onSubtitleChange: options.onSubtitleChange,
      createVideoElement: options.createVideoElement,
      createAudioElement: options.createAudioElement,
    });
  }

  return createMockAvatarProvider({
    onSubtitleChange: options.onSubtitleChange,
    onAmplitudeChange: options.onAmplitudeChange,
    createVideoElement: options.createVideoElement,
    createAudioElement: options.createAudioElement,
  });
}
