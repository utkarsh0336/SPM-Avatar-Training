export type ProviderErrorKind = "rate_limited" | "auth_error" | "server_error" | "other";

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    public readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function classifyHttpStatus(status: number): ProviderErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth_error";
  if (status >= 500) return "server_error";
  return "other";
}

/**
 * Builds (does not throw) a classified ProviderError from a failed fetch
 * Response — callers do `throw await buildProviderError(...)` themselves so
 * control flow stays visible at the call site.
 */
export async function buildProviderError(provider: string, response: Response): Promise<ProviderError> {
  const kind = classifyHttpStatus(response.status);
  const body = await response.text().catch(() => "");
  return new ProviderError(
    kind,
    provider,
    `${provider} request failed (${response.status}): ${body.slice(0, 500)}`,
  );
}
