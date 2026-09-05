import { AuthNoRoleAssignedError, SsoAuthenticationFailedError, SsoUserNotProvisionedError, type PermissionMatrix } from "@nextbot/contracts";
import { resolveTenantBySlug, type ResolvedTenant } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import { mergePermissionMatrices } from "../domain/permission-matrix.js";
import {
  findUserBySsoSubject,
  findUserByEmail,
  getUserRolesAndMatrix,
  iamTenantContext,
  insertLoginAttempt,
  insertUser,
  linkSsoSubject,
  recordSuccessfulLogin,
} from "../infrastructure/user-repository.js";
import { syncSsoRoleAssignment } from "../infrastructure/role-repository.js";
import { resolveRoleIdsForGroups } from "../infrastructure/sso-group-mapping-repository.js";
import { insertAuthSession } from "../infrastructure/session-repository.js";
import { issueSessionToken } from "./session-token.js";
import { buildOidcAuthorizationUrl, completeOidcCallback } from "./sso-login-oidc.js";
import { buildSamlAuthorizeUrl, completeSamlCallback } from "./sso-login-saml.js";
import { getSsoConnectionConfig } from "./sso-connection.js";

export interface SsoLoginSuccess {
  sessionToken: string;
  userId: string;
  roleIds: string[];
  permissions: PermissionMatrix;
}

/** Shared claims shape both protocol adapters normalize to before this module's
 * single login-resolution path runs — keeps "how do we turn an IdP identity into
 * a NextBot session" protocol-agnostic (README decision #1). */
interface NormalizedIdentity {
  subject: string;
  email: string | null;
  groups: string[];
  jitProvisioningEnabled: boolean;
  defaultRoleId: string | null;
}

/**
 * Resolves a validated IdP identity to a real, tenant-scoped `app_user` and
 * issues a session — the single choke point every SSO login (SAML or OIDC)
 * passes through, so the tenant-isolation and fail-closed provisioning rules are
 * enforced exactly once, not duplicated per protocol.
 *
 * Tenant isolation (ADR-0001): `ctx` is always derived from the tenant whose
 * `sso_connection` the caller validated the assertion/token against — there is
 * no code path here that accepts a tenant id from the IdP payload itself, so an
 * IdP cannot assert its way into a different tenant's data than the one its
 * connection belongs to.
 *
 * @throws {SsoUserNotProvisionedError} JIT disabled and no matching invited user.
 * @throws {AuthNoRoleAssignedError} the resolved user ends up with zero roles
 *   (FR-ADM-02's fail-closed rule, unchanged for the SSO path).
 */
async function resolveIdentityAndIssueSession(
  ctx: TenantContext,
  tenant: ResolvedTenant,
  identity: NormalizedIdentity,
  meta?: { ip?: string; userAgent?: string },
): Promise<SsoLoginSuccess> {
  let userId: string | undefined = (await findUserBySsoSubject(ctx, identity.subject))?.id;

  if (!userId && identity.email) {
    // Not yet linked by subject — an existing (e.g. password-invited) user with
    // the same asserted email is linked on this first SSO login, regardless of
    // the JIT setting (this is "use SSO for an account that already exists,"
    // not new-account creation).
    const byEmail = await findUserByEmail(ctx, identity.email);
    if (byEmail) {
      await linkSsoSubject(ctx, byEmail.id, identity.subject);
      userId = byEmail.id;
    }
  }

  if (!userId) {
    if (!identity.jitProvisioningEnabled) {
      await insertLoginAttempt(ctx, { email: identity.email ?? identity.subject, outcome: "SsoFailed", ip: meta?.ip, userAgent: meta?.userAgent });
      throw new SsoUserNotProvisionedError();
    }
    const displayName = identity.email ?? identity.subject;
    userId = await insertUser(ctx, {
      email: identity.email ?? `${identity.subject}@sso.internal`,
      passwordHash: null,
      displayName,
      ssoSubject: identity.subject,
    });
  }

  // Role assignment is always re-derived fresh from the current group mapping
  // (never trusted from whatever was assigned at a prior login) — an IdP-side
  // group change takes effect on the very next SSO login. QA 20260829-054900
  // Finding 1: this MUST be a set-replacement (add newly-asserted, remove
  // no-longer-asserted), not the additive `assignRolesToUser` this used to call —
  // see `syncSsoRoleAssignment`'s doc comment for why it only ever touches
  // `source = 'Sso'` rows (a manually-granted console/SCIM role is never affected)
  // and never shrinks the SSO-derived set to zero.
  const mappedRoleIds = await resolveRoleIdsForGroups(ctx, identity.groups);
  const roleIdsToAssign = mappedRoleIds.length > 0 ? mappedRoleIds : identity.defaultRoleId ? [identity.defaultRoleId] : [];
  await syncSsoRoleAssignment(ctx, userId, roleIdsToAssign);

  const { roleIds, matrices } = await getUserRolesAndMatrix(ctx, userId);
  if (roleIds.length === 0) {
    await insertLoginAttempt(ctx, { email: identity.email ?? identity.subject, outcome: "NoRole", ip: meta?.ip, userAgent: meta?.userAgent });
    throw new AuthNoRoleAssignedError();
  }

  await recordSuccessfulLogin(ctx, userId);
  await insertLoginAttempt(ctx, { email: identity.email ?? identity.subject, outcome: "Success", ip: meta?.ip, userAgent: meta?.userAgent });

  const permissions = mergePermissionMatrices(matrices);
  const sid = await insertAuthSession(ctx, { userId, ip: meta?.ip, userAgent: meta?.userAgent });
  const sessionToken = await issueSessionToken({ tenantId: tenant.id, userId, roleIds, permissions, sid });
  return { sessionToken, userId, roleIds, permissions };
}

/**
 * Builds the SSO login redirect URL for a tenant — dispatches to the
 * connection's configured protocol. Takes BOTH possible callback (ACS/redirect)
 * URLs rather than one, since which one is correct depends on the connection's
 * protocol, which isn't known to the caller until this function has already
 * resolved it — never guessed/precomputed by the route handler itself.
 */
export async function buildSsoLoginUrl(
  tenantSlug: string,
  input: { oidcCallbackUrl: string; samlCallbackUrl: string; state: string; nonce: string },
): Promise<{ url: string; protocol: "Saml" | "Oidc" }> {
  const tenant = await resolveTenantBySlug(tenantSlug);
  if (!tenant) throw new SsoAuthenticationFailedError();
  const ctx = iamTenantContext(tenant.id, tenant.region);
  const connection = await getSsoConnectionConfig(ctx);
  if (!connection || connection.status !== "Active") throw new SsoAuthenticationFailedError();

  if (connection.protocol === "Oidc") {
    const url = await buildOidcAuthorizationUrl(ctx, { redirectUri: input.oidcCallbackUrl, state: input.state, nonce: input.nonce });
    return { url, protocol: "Oidc" };
  }
  const url = await buildSamlAuthorizeUrl(ctx, input.samlCallbackUrl, input.state);
  return { url, protocol: "Saml" };
}

/** Completes an OIDC callback and issues a session. */
export async function completeOidcLogin(
  tenantSlug: string,
  input: { currentUrl: URL; expectedState: string; expectedNonce: string; ip?: string; userAgent?: string },
): Promise<SsoLoginSuccess> {
  const tenant = await resolveTenantBySlug(tenantSlug);
  if (!tenant) throw new SsoAuthenticationFailedError();
  const ctx = iamTenantContext(tenant.id, tenant.region);

  const result = await completeOidcCallback(ctx, input);
  return resolveIdentityAndIssueSession(
    ctx,
    tenant,
    {
      subject: result.subject,
      email: result.email,
      groups: result.groups,
      jitProvisioningEnabled: result.connection.jitProvisioningEnabled,
      defaultRoleId: result.connection.defaultRoleId,
    },
    { ip: input.ip, userAgent: input.userAgent },
  );
}

/** Completes a SAML ACS POST and issues a session. */
export async function completeSamlLogin(
  tenantSlug: string,
  input: { callbackUrl: string; body: Record<string, string>; ip?: string; userAgent?: string },
): Promise<SsoLoginSuccess> {
  const tenant = await resolveTenantBySlug(tenantSlug);
  if (!tenant) throw new SsoAuthenticationFailedError();
  const ctx = iamTenantContext(tenant.id, tenant.region);

  const result = await completeSamlCallback(ctx, input.callbackUrl, input.body);
  return resolveIdentityAndIssueSession(
    ctx,
    tenant,
    {
      subject: result.nameId,
      email: result.email,
      groups: result.groups,
      jitProvisioningEnabled: result.connection.jitProvisioningEnabled,
      defaultRoleId: result.connection.defaultRoleId,
    },
    { ip: input.ip, userAgent: input.userAgent },
  );
}
