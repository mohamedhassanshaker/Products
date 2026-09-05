import { requirePermission } from "../domain/permission-matrix.js";
import type { SessionClaims } from "../application/session-token.js";
import { getSsoConnectionConfig, setConnectionStatus, upsertConnection } from "../application/sso-connection.js";
import { listSsoGroupMappings, upsertSsoGroupMapping, deleteSsoGroupMapping } from "../infrastructure/sso-group-mapping-repository.js";
import { iamTenantContext } from "../infrastructure/user-repository.js";
import { resolveTenantById } from "@nextbot/tenancy";
import type { UpdateSsoConnectionStatusRequest, UpsertSsoConnectionRequest } from "@nextbot/contracts";

/**
 * `/settings/sso` admin surface (Phase 4, BL-36). Gated on `security_settings`
 * (Read to view, Write to mutate) — the same RBAC module Branding/PII/Data-
 * policy already use for tenant-wide security-adjacent configuration screens.
 */

async function tenantCtx(session: SessionClaims) {
  const tenant = await resolveTenantById(session.tenantId);
  if (!tenant) throw new Error("tenant not found for session");
  return iamTenantContext(session.tenantId, tenant.region);
}

/** Never returns the OIDC client secret/SAML cert verbatim in a way that would
 * defeat "shown only masked in any UI" (FR-SEC-02's rule, applied here too) —
 * the console shows whether a secret is *set*, not its value. */
export async function handleGetSsoConnection(session: SessionClaims) {
  requirePermission(session.permissions, "security_settings", "Read");
  const ctx = await tenantCtx(session);
  const connection = await getSsoConnectionConfig(ctx);
  if (!connection) return null;
  return {
    id: connection.id,
    protocol: connection.protocol,
    displayName: connection.displayName,
    status: connection.status,
    jitProvisioningEnabled: connection.jitProvisioningEnabled,
    defaultRoleId: connection.defaultRoleId,
    groupClaimName: connection.groupClaimName,
    oidcIssuerUrl: connection.oidcIssuerUrl,
    oidcClientId: connection.oidcClientId,
    oidcClientSecretSet: Boolean(connection.oidcClientSecretCiphertext),
    samlEntryPoint: connection.samlEntryPoint,
    samlIssuer: connection.samlIssuer,
    samlIdpCertificateSet: Boolean(connection.samlIdpCertificate),
  };
}

export async function handleUpsertSsoConnection(session: SessionClaims, input: UpsertSsoConnectionRequest) {
  requirePermission(session.permissions, "security_settings", "Write");
  const ctx = await tenantCtx(session);
  return upsertConnection(ctx, input);
}

export async function handleSetSsoConnectionStatus(session: SessionClaims, input: UpdateSsoConnectionStatusRequest) {
  requirePermission(session.permissions, "security_settings", "Write");
  const ctx = await tenantCtx(session);
  await setConnectionStatus(ctx, input.status);
}

export async function handleListSsoGroupMappings(session: SessionClaims) {
  requirePermission(session.permissions, "security_settings", "Read");
  const ctx = await tenantCtx(session);
  return listSsoGroupMappings(ctx);
}

export async function handleUpsertSsoGroupMapping(session: SessionClaims, input: { externalGroup: string; roleId: string }) {
  requirePermission(session.permissions, "security_settings", "Write");
  const ctx = await tenantCtx(session);
  await upsertSsoGroupMapping(ctx, input.externalGroup, input.roleId);
}

export async function handleDeleteSsoGroupMapping(session: SessionClaims, id: string) {
  requirePermission(session.permissions, "security_settings", "Write");
  const ctx = await tenantCtx(session);
  await deleteSsoGroupMapping(ctx, id);
}
