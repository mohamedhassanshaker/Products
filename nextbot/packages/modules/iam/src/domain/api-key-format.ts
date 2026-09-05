import { generateRandomSecret } from "./token-hash.js";

/**
 * Phase 4 (BL-36, FR-SEC-10/FR-API-01) — the `nbk_…` tenant API key format LLD
 * §5.1 names for `/api/v1/admin/**`: `nbk_<tenantSlug>.<keyId>.<secret>`.
 *
 * Embedding the tenant slug directly in the key (README decision #3) means
 * verifying a presented key never needs a cross-tenant table scan or a
 * `withPlatform()` bypass — the slug resolves the tenant via the same public
 * `resolveTenantBySlug()` the password-login path already uses, then `keyId` is
 * looked up with an ordinary tenant-scoped, RLS-protected read
 * (`WHERE tenant_id = ... AND key_prefix = ...`), and only then is the secret
 * argon2-verified against that one row's hash. Tenant slugs are not secret
 * (they already appear in the login URL), so embedding one here discloses
 * nothing a network observer couldn't already infer from the tenant's own login
 * page — only `keyId`/`secret` need to stay confidential, and both are.
 */
const KEY_PREFIX = "nbk_";

export interface ParsedApiKey {
  tenantSlug: string;
  keyId: string;
  secret: string;
}

/** Builds the full bearer-token string returned to the caller exactly once at
 * issuance time — the secret is never retrievable again afterward (only its hash
 * is persisted). */
export function formatApiKey(tenantSlug: string, keyId: string, secret: string): string {
  return `${KEY_PREFIX}${tenantSlug}.${keyId}.${secret}`;
}

export function generateApiKeyId(): string {
  // 12 base64url chars (~9 bytes / 72 bits) — plenty of entropy for a per-tenant
  // lookup key that is not itself the secret (the secret segment carries the
  // real cryptographic weight).
  return generateRandomSecret(9);
}

export function generateApiKeySecret(): string {
  return generateRandomSecret(32);
}

/** Parses a presented `Authorization: Bearer nbk_…` value. Returns `null` (never
 * throws) for anything that doesn't match the expected shape — the caller treats
 * a parse failure identically to an invalid key (fail-closed, no distinct error
 * message that could help an attacker iterate on the format). */
export function parseApiKey(raw: string): ParsedApiKey | null {
  if (!raw.startsWith(KEY_PREFIX)) return null;
  const rest = raw.slice(KEY_PREFIX.length);
  const parts = rest.split(".");
  if (parts.length !== 3) return null;
  const [tenantSlug, keyId, secret] = parts;
  if (!tenantSlug || !keyId || !secret) return null;
  return { tenantSlug, keyId, secret };
}
