import { resolveTenantById } from "@nextbot/tenancy";
import type { CreateServiceAccountRequest, IssueApiKeyRequest } from "@nextbot/contracts";
import { requirePermission } from "../domain/permission-matrix.js";
import type { SessionClaims } from "../application/session-token.js";
import {
  createServiceAccount,
  disableServiceAccount,
  issueApiKey,
  listApiKeys,
  listServiceAccounts,
  revokeApiKeyAction,
} from "../application/service-account.js";
import { iamTenantContext } from "../infrastructure/user-repository.js";

/** Service accounts + scoped API keys (Phase 4, BL-36, FR-SEC-10). Gated
 * `users_roles` — creating/disabling a service account and issuing/revoking its
 * keys is user/identity administration, the same module the human user/role
 * screens already use. */

async function tenantCtxAndSlug(session: SessionClaims) {
  const tenant = await resolveTenantById(session.tenantId);
  if (!tenant) throw new Error("tenant not found for session");
  return { ctx: iamTenantContext(session.tenantId, tenant.region), slug: tenant.slug };
}

export async function handleListServiceAccounts(session: SessionClaims) {
  requirePermission(session.permissions, "users_roles", "Read");
  const { ctx } = await tenantCtxAndSlug(session);
  return listServiceAccounts(ctx);
}

export async function handleCreateServiceAccount(session: SessionClaims, input: CreateServiceAccountRequest) {
  requirePermission(session.permissions, "users_roles", "Write");
  const { ctx } = await tenantCtxAndSlug(session);
  return createServiceAccount(ctx, input);
}

export async function handleDisableServiceAccount(session: SessionClaims, serviceAccountUserId: string) {
  requirePermission(session.permissions, "users_roles", "Write");
  const { ctx } = await tenantCtxAndSlug(session);
  await disableServiceAccount(ctx, serviceAccountUserId);
}

export async function handleListApiKeys(session: SessionClaims, serviceAccountUserId: string) {
  requirePermission(session.permissions, "users_roles", "Read");
  const { ctx } = await tenantCtxAndSlug(session);
  return listApiKeys(ctx, serviceAccountUserId);
}

export async function handleIssueApiKey(session: SessionClaims, serviceAccountUserId: string, input: IssueApiKeyRequest) {
  requirePermission(session.permissions, "users_roles", "Write");
  const { ctx, slug } = await tenantCtxAndSlug(session);
  return issueApiKey(ctx, slug, serviceAccountUserId, input);
}

export async function handleRevokeApiKey(session: SessionClaims, apiKeyId: string) {
  requirePermission(session.permissions, "users_roles", "Write");
  const { ctx } = await tenantCtxAndSlug(session);
  await revokeApiKeyAction(ctx, apiKeyId);
}
