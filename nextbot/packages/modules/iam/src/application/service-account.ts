import {
  ApiKeyInvalidError,
  InvalidRoleAssignmentError,
  ServiceAccountNotFoundError,
  type IssueApiKeyRequest,
} from "@nextbot/contracts";
import { resolveTenantBySlug, type ResolvedTenant } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import type { SessionClaims } from "./session-token.js";
import { mergePermissionMatrices } from "../domain/permission-matrix.js";
import { formatApiKey, generateApiKeyId, generateApiKeySecret, parseApiKey } from "../domain/api-key-format.js";
import { hashBearerSecret, verifyBearerSecret } from "../domain/token-hash.js";
import { assertScopeWithinAccountMatrix, intersectMatrices } from "../domain/permission-scope.js";
import { findRolesByIds, assignRolesToUser } from "../infrastructure/role-repository.js";
import {
  findUserById,
  getUserRolesAndMatrix,
  iamTenantContext,
  insertServiceAccount,
  listServiceAccountsWithRoles,
  setUserStatus,
  type UserWithRoles,
} from "../infrastructure/user-repository.js";
import { findApiKeyByPrefix, insertApiKey, listApiKeysForServiceAccount, revokeApiKey, touchApiKey } from "../infrastructure/api-key-repository.js";
import { revokeAllSessionsForUser } from "../infrastructure/session-repository.js";

/**
 * Service accounts + scoped API keys (Phase 4, BL-36, FR-SEC-10). README
 * decision #6: a service account is an `app_user` row (`kind = 'ServiceAccount'`)
 * assigned roles through the exact same `user_role` table/RBAC matrix a human
 * user uses — there is no second, parallel permission model to keep in sync.
 */

export async function listServiceAccounts(ctx: TenantContext): Promise<UserWithRoles[]> {
  return listServiceAccountsWithRoles(ctx);
}

/** Creates a service account with an initial role assignment (at least one role
 * required — mirrors FR-ADM-02's fail-closed rule for human users; a role-less
 * service account could never do anything useful anyway). */
export async function createServiceAccount(ctx: TenantContext, input: { name: string; roleIds: string[] }): Promise<string> {
  const requestedIds = Array.from(new Set(input.roleIds));
  const resolvedRoles = await findRolesByIds(ctx, requestedIds);
  if (resolvedRoles.length !== requestedIds.length) throw new InvalidRoleAssignmentError();

  const userId = await insertServiceAccount(ctx, { name: input.name });
  await assignRolesToUser(ctx, userId, requestedIds);
  return userId;
}

/** Disables a service account (never deletes — same "no destructive action" rule
 * SCIM deprovisioning follows) and immediately revokes every session-equivalent
 * (its active API keys stop working on their very next use — see
 * `verifyApiKey`, which re-checks the account's live status on every call rather
 * than trusting a cached "was active at issuance time" fact). */
export async function disableServiceAccount(ctx: TenantContext, serviceAccountUserId: string): Promise<void> {
  const account = await findUserById(ctx, serviceAccountUserId);
  if (!account || account.kind !== "ServiceAccount") throw new ServiceAccountNotFoundError();
  await setUserStatus(ctx, serviceAccountUserId, "Disabled");
  await revokeAllSessionsForUser(ctx, serviceAccountUserId); // defensive — service accounts don't normally hold browser sessions.
}

/**
 * Issues a new scoped API key for a service account. The full key
 * (`nbk_<tenantSlug>.<keyId>.<secret>`) is returned exactly once — only its
 * argon2id hash is ever persisted, matching this codebase's established
 * credential-storage pattern (`domain/password.ts` / `mfa_secret`).
 *
 * @throws {ServiceAccountNotFoundError} `serviceAccountUserId` isn't a
 *   ServiceAccount-kind user in this tenant.
 * @throws {ApiKeyScopeExceedsAccountError} `scopeMatrix` exceeds the account's
 *   own role-derived permissions.
 */
export async function issueApiKey(
  ctx: TenantContext,
  tenantSlug: string,
  serviceAccountUserId: string,
  input: IssueApiKeyRequest,
): Promise<{ apiKeyId: string; key: string }> {
  const account = await findUserById(ctx, serviceAccountUserId);
  if (!account || account.kind !== "ServiceAccount") throw new ServiceAccountNotFoundError();

  if (input.scopeMatrix) {
    const { matrices } = await getUserRolesAndMatrix(ctx, serviceAccountUserId);
    assertScopeWithinAccountMatrix(mergePermissionMatrices(matrices), input.scopeMatrix);
  }

  const keyId = generateApiKeyId();
  const secret = generateApiKeySecret();
  const keyHash = await hashBearerSecret(secret);
  const apiKeyId = await insertApiKey(ctx, {
    serviceAccountUserId,
    name: input.name,
    keyPrefix: keyId,
    keyHash,
    scopeMatrix: input.scopeMatrix ?? null,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
  });
  return { apiKeyId, key: formatApiKey(tenantSlug, keyId, secret) };
}

export async function listApiKeys(ctx: TenantContext, serviceAccountUserId: string) {
  return listApiKeysForServiceAccount(ctx, serviceAccountUserId);
}

/** Revokes an API key — takes effect on its very next use (`verifyApiKey` reads
 * `revoked_at` fresh from the DB on every call, no caching layer in between). */
export async function revokeApiKeyAction(ctx: TenantContext, apiKeyId: string): Promise<void> {
  await revokeApiKey(ctx, apiKeyId);
}

/**
 * Verifies a presented `Authorization: Bearer nbk_…` key end to end and
 * resolves it to a `SessionClaims`-shaped `AuthContext` — the composition
 * root's (`apps/web/src/lib/session.ts`) alternative to the session cookie for
 * `/api/v1/admin/**` (LLD §5.1). Every check here is fail-closed: a malformed
 * key, unresolvable tenant slug, unknown/revoked/expired key row, wrong secret,
 * or a disabled service account all collapse to the single generic
 * `ApiKeyInvalidError` (no distinct message that would help an attacker
 * enumerate which check failed).
 *
 * @throws {ApiKeyInvalidError} on any verification failure.
 */
export async function verifyApiKey(rawKey: string): Promise<SessionClaims> {
  const parsed = parseApiKey(rawKey);
  if (!parsed) throw new ApiKeyInvalidError();

  const tenant: ResolvedTenant | null = await resolveTenantBySlug(parsed.tenantSlug);
  if (!tenant) throw new ApiKeyInvalidError();
  const ctx = iamTenantContext(tenant.id, tenant.region);

  const row = await findApiKeyByPrefix(ctx, parsed.keyId);
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) throw new ApiKeyInvalidError();

  const secretOk = await verifyBearerSecret(row.keyHash, parsed.secret);
  if (!secretOk) throw new ApiKeyInvalidError();

  const account = await findUserById(ctx, row.serviceAccountUserId);
  if (!account || account.kind !== "ServiceAccount" || account.status !== "Active") throw new ApiKeyInvalidError();

  const { roleIds, matrices } = await getUserRolesAndMatrix(ctx, row.serviceAccountUserId);
  const accountMatrix = mergePermissionMatrices(matrices);
  // Intersection, never widening: the key's own scope_matrix (if set) further
  // restricts the account's role-derived matrix — the account matrix alone is
  // the ceiling, exactly like a human user's own role assignment.
  const effective = intersectMatrices(accountMatrix, row.scopeMatrix);

  await touchApiKey(ctx, row.id);

  return { tenantId: tenant.id, userId: row.serviceAccountUserId, roleIds, permissions: effective };
}
