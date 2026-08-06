import { hash, verify } from "@node-rs/argon2";

/**
 * argon2id, native NAPI bindings — see .claude/specs/authentication.md's
 * Dependencies section for why this over the node-gyp `argon2` package.
 * Only ever called from apps/api; never bundle into apps/dashboard.
 *
 * The library's defaults (4 MiB memory, t=3) are well below OWASP's
 * Argon2id minimum (m>=19456 KiB, t=2) — memoryCost is what actually gives
 * Argon2 its GPU/ASIC resistance, so this is set explicitly rather than
 * left at the default. The encoded hash string embeds these params, so
 * verifyPassword needs no corresponding change if they're tuned later.
 */
const HASH_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return verify(passwordHash, password);
}
