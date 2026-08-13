import { embedConfigResponseSchema, embedTicketResponseSchema, type EmbedConfigResponse, type EmbedTicketResponse } from "@avatrain/shared/contracts";

/**
 * Unlike apps/dashboard's api-client.ts, this calls apps/api DIRECTLY —
 * there's no same-origin cookie-carrying proxy for an embed running on a
 * third-party page, and none is needed: routes/embed.ts is public,
 * publishable-key-authenticated, never cookie-authenticated. CORS is
 * handled server-side per-request (exact-origin, keyed by the Application's
 * allowedOrigins) — see apps/api/src/routes/embed.ts.
 */
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export class EmbedApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = "EmbedApiError";
  }
}

async function embedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "unknown_error" }))) as { error?: string };
    throw new EmbedApiError(response.status, body.error ?? "unknown_error");
  }
  return response.json() as Promise<T>;
}

export async function getEmbedConfig(key: string): Promise<EmbedConfigResponse> {
  const result = await embedFetch<unknown>(`/v1/embed/config?key=${encodeURIComponent(key)}`);
  return embedConfigResponseSchema.parse(result);
}

export async function mintEmbedTicket(key: string): Promise<EmbedTicketResponse> {
  const result = await embedFetch<unknown>(`/v1/embed/ticket?key=${encodeURIComponent(key)}`, { method: "POST" });
  return embedTicketResponseSchema.parse(result);
}
