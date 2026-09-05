import { SessionNotFoundError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import {
  listActiveSessionsForTenant,
  listActiveSessionsForUser,
  revokeAllSessionsForUser,
  revokeSession,
  type AuthSessionRow,
} from "../infrastructure/session-repository.js";

/** Phase 4 (BL-36, FR-SEC-10) — session listing/revocation. Personal ("my
 * sessions") and admin ("all tenant sessions") views share the same underlying
 * revocation primitive (`revokeSession`), differing only in whether the caller
 * may target another user's session — that scoping is enforced by the http
 * layer's RBAC check, never by this application layer guessing intent from the
 * caller's own id. */

export async function listMySessions(ctx: TenantContext, userId: string): Promise<AuthSessionRow[]> {
  return listActiveSessionsForUser(ctx, userId);
}

export async function listTenantSessions(ctx: TenantContext) {
  return listActiveSessionsForTenant(ctx);
}

/** Revokes a session the caller owns (self-service "sign out of this device"). */
export async function revokeMySession(ctx: TenantContext, userId: string, sessionId: string): Promise<void> {
  const before = await listActiveSessionsForUser(ctx, userId);
  if (!before.some((s) => s.id === sessionId)) throw new SessionNotFoundError();
  await revokeSession(ctx, sessionId, userId);
}

/** Signs the caller out of every active session (their own) — "sign out
 * everywhere" after a suspected compromise. */
export async function revokeAllMySessions(ctx: TenantContext, userId: string): Promise<void> {
  await revokeAllSessionsForUser(ctx, userId);
}

/** Admin action: revokes any user's session in the tenant (RBAC-gated
 * `users_roles` Write by the http layer — same module the rest of user/role
 * administration already uses). */
export async function adminRevokeSession(ctx: TenantContext, sessionId: string): Promise<void> {
  await revokeSession(ctx, sessionId);
}

/** Admin action: revokes every active session belonging to a specific user
 * (e.g. immediately following a role change or suspected compromise). */
export async function adminRevokeAllSessionsForUser(ctx: TenantContext, userId: string): Promise<void> {
  await revokeAllSessionsForUser(ctx, userId);
}
