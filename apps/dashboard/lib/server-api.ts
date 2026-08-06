import { cookies } from "next/headers";
import type { AuthOrg, AuthRole, AuthUser } from "./api-client";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export interface MeResult {
  user: AuthUser;
  org: AuthOrg;
  role: AuthRole;
}

/** Server-to-server call, cookies forwarded directly — never goes through
 * the /api/* proxy and is never subject to browser CORS. */
export async function getMe(): Promise<MeResult | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const response = await fetch(`${API_URL}/v1/auth/me`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: "no-store",
  });

  if (!response.ok) return null;
  return (await response.json()) as MeResult;
}
