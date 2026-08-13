/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** apps/api's base URL — the widget calls it directly (no cookie proxy, embed.ts is public). Defaults to http://localhost:4000. */
  readonly VITE_API_URL?: string;
  /** apps/api's WS base URL. Defaults to ws://localhost:4000. */
  readonly VITE_API_WS_URL?: string;
  /** Same values/meaning as apps/dashboard's NEXT_PUBLIC_AVATAR_PROVIDER — "mock" | "simli" | (default) "vrm". */
  readonly VITE_AVATAR_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
