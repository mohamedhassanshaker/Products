import { resolveTenantById } from "@nextbot/tenancy";
import { requirePermission } from "../domain/permission-matrix.js";
import type { SessionClaims } from "../application/session-token.js";
import { adminRevokeAllSessionsForUser, adminRevokeSession, listMySessions, listTenantSessions, revokeAllMySessions, revokeMySession } from "../application/session-management.js";
import { iamTenantContext } from "../infrastructure/user-repository.js";

/** Session management (Phase 4, BL-36, FR-SEC-10). Self-service ("my sessions")
 * needs no RBAC beyond being authenticated — a user always has the right to see
 * and revoke their own sessions. The admin-facing tenant-wide view is gated
 * `users_roles` (the same module the rest of user/role administration uses). */

async function tenantCtx(session: SessionClaims) {
  const tenant = await resolveTenantById(session.tenantId);
  if (!tenant) throw new Error("tenant not found for session");
  return iamTenantContext(session.tenantId, tenant.region);
}

export async function handleListMySessions(session: SessionClaims) {
  const ctx = await tenantCtx(session);
  return listMySessions(ctx, session.userId);
}

export async function handleRevokeMySession(session: SessionClaims, sessionId: string) {
  const ctx = await tenantCtx(session);
  await revokeMySession(ctx, session.userId, sessionId);
}

export async function handleRevokeAllMySessions(session: SessionClaims) {
  const ctx = await tenantCtx(session);
  await revokeAllMySessions(ctx, session.userId);
}

export async function handleListTenantSessions(session: SessionClaims) {
  requirePermission(session.permissions, "users_roles", "Read");
  const ctx = await tenantCtx(session);
  return listTenantSessions(ctx);
}

export async function handleAdminRevokeSession(session: SessionClaims, sessionId: string) {
  requirePermission(session.permissions, "users_roles", "Write");
  const ctx = await tenantCtx(session);
  await adminRevokeSession(ctx, sessionId);
}

export async function handleAdminRevokeAllSessionsForUser(session: SessionClaims, userId: string) {
  requirePermission(session.permissions, "users_roles", "Write");
  const ctx = await tenantCtx(session);
  await adminRevokeAllSessionsForUser(ctx, userId);
}
