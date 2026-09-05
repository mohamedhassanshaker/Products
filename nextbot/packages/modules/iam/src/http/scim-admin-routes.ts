import { resolveTenantById } from "@nextbot/tenancy";
import { requirePermission } from "../domain/permission-matrix.js";
import type { SessionClaims } from "../application/session-token.js";
import { hasActiveScimToken, revokeScimToken, rotateScimToken } from "../application/scim-token.js";
import { iamTenantContext } from "../infrastructure/user-repository.js";

/** SCIM bearer-token admin (Phase 4, BL-36, FR-SEC-10) — `security_settings`
 * gated, same as the SSO connection screen it lives alongside in the console. */

async function tenantCtx(session: SessionClaims) {
  const tenant = await resolveTenantById(session.tenantId);
  if (!tenant) throw new Error("tenant not found for session");
  return iamTenantContext(session.tenantId, tenant.region);
}

export async function handleGetScimTokenStatus(session: SessionClaims) {
  requirePermission(session.permissions, "security_settings", "Read");
  const ctx = await tenantCtx(session);
  return { active: await hasActiveScimToken(ctx) };
}

/** Rotates (issues, replacing any existing) the tenant's SCIM token. The
 * plaintext is returned exactly once — never again retrievable. */
export async function handleRotateScimToken(session: SessionClaims) {
  requirePermission(session.permissions, "security_settings", "Write");
  const ctx = await tenantCtx(session);
  return { token: await rotateScimToken(ctx) };
}

export async function handleRevokeScimToken(session: SessionClaims) {
  requirePermission(session.permissions, "security_settings", "Write");
  const ctx = await tenantCtx(session);
  await revokeScimToken(ctx);
}
