import { ScimAuthenticationFailedError, SsoPlanTierNotEligibleError } from "@nextbot/contracts";
import { getTenantPlanTier, resolveTenantBySlug } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import { generateRandomSecret, hashBearerSecret, verifyBearerSecret } from "../domain/token-hash.js";
import { getActiveScimToken, rotateScimToken as rotateScimTokenRow, revokeScimToken as revokeScimTokenRow, touchScimToken } from "../infrastructure/scim-token-repository.js";
import { iamTenantContext } from "../infrastructure/user-repository.js";

const SCIM_TOKEN_PREFIX = "scim_";

/**
 * SCIM bearer token issuance/verification (Phase 4, BL-36, FR-SEC-10) — the
 * "IdP calling into NextBot" auth boundary, held to the same rigor as the
 * widget's session-token boundary per the security brief: a single active,
 * argon2id-hashed token per tenant (README decision #4), rotate-only (no
 * plaintext ever re-shown after issuance), NFR-17 Enterprise-tier gated.
 */

export async function rotateScimToken(ctx: TenantContext): Promise<string> {
  const tier = await getTenantPlanTier(ctx);
  if (tier !== "Enterprise") throw new SsoPlanTierNotEligibleError();

  const secret = generateRandomSecret(24);
  const tokenHash = await hashBearerSecret(secret);
  await rotateScimTokenRow(ctx, { tokenPrefix: secret.slice(0, 8), tokenHash });
  return `${SCIM_TOKEN_PREFIX}${secret}`;
}

export async function revokeScimToken(ctx: TenantContext): Promise<void> {
  await revokeScimTokenRow(ctx);
}

export async function hasActiveScimToken(ctx: TenantContext): Promise<boolean> {
  return (await getActiveScimToken(ctx)) !== null;
}

/**
 * Resolves `/api/scim/v2/{tenantSlug}/**`'s bearer token to a `TenantContext` —
 * tenant is resolved from the URL path slug (README decision #4, no
 * cross-tenant scan), then the presented secret is argon2-verified against that
 * one tenant's single active token. Fail-closed: unresolvable tenant slug, no
 * active token, or a mismatched secret all collapse to the same generic
 * `ScimAuthenticationFailedError`.
 *
 * @throws {ScimAuthenticationFailedError} on any verification failure.
 */
export async function verifyScimBearerToken(tenantSlug: string, rawToken: string): Promise<TenantContext> {
  if (!rawToken.startsWith(SCIM_TOKEN_PREFIX)) throw new ScimAuthenticationFailedError();
  const tenant = await resolveTenantBySlug(tenantSlug);
  if (!tenant) throw new ScimAuthenticationFailedError();

  const ctx = iamTenantContext(tenant.id, tenant.region);
  const row = await getActiveScimToken(ctx);
  if (!row) throw new ScimAuthenticationFailedError();

  const secret = rawToken.slice(SCIM_TOKEN_PREFIX.length);
  const ok = await verifyBearerSecret(row.tokenHash, secret);
  if (!ok) throw new ScimAuthenticationFailedError();

  await touchScimToken(ctx, row.id);
  return ctx;
}
