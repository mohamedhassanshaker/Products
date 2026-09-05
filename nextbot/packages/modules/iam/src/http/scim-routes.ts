import { verifyScimBearerToken } from "../application/scim-token.js";
import {
  createScimUser,
  deleteScimUser,
  getScimUser,
  listScimUsers,
  replaceScimUser,
  setScimUserActive,
  type CreateScimUserInput,
  type ReplaceScimUserInput,
} from "../application/scim-users.js";

/**
 * `/api/scim/v2/{tenantSlug}/**` (Phase 4, BL-36, FR-SEC-10) — every function
 * here re-verifies the bearer token against `tenantSlug` itself (rather than
 * trusting a session/context resolved elsewhere), since this is a distinct,
 * IdP-facing external auth boundary with no session cookie in play at all —
 * held to the same rigor as the widget's session-token boundary (LLD §5.1),
 * not the Admin Console's RBAC path.
 */

export async function handleScimListUsers(tenantSlug: string, bearerToken: string, filterUserName?: string) {
  const ctx = await verifyScimBearerToken(tenantSlug, bearerToken);
  return listScimUsers(ctx, filterUserName);
}

export async function handleScimGetUser(tenantSlug: string, bearerToken: string, id: string) {
  const ctx = await verifyScimBearerToken(tenantSlug, bearerToken);
  return getScimUser(ctx, id);
}

export async function handleScimCreateUser(tenantSlug: string, bearerToken: string, input: CreateScimUserInput) {
  const ctx = await verifyScimBearerToken(tenantSlug, bearerToken);
  return createScimUser(ctx, input);
}

export async function handleScimReplaceUser(tenantSlug: string, bearerToken: string, id: string, input: ReplaceScimUserInput) {
  const ctx = await verifyScimBearerToken(tenantSlug, bearerToken);
  return replaceScimUser(ctx, id, input);
}

export async function handleScimSetActive(tenantSlug: string, bearerToken: string, id: string, active: boolean) {
  const ctx = await verifyScimBearerToken(tenantSlug, bearerToken);
  return setScimUserActive(ctx, id, active);
}

export async function handleScimDeleteUser(tenantSlug: string, bearerToken: string, id: string) {
  const ctx = await verifyScimBearerToken(tenantSlug, bearerToken);
  await deleteScimUser(ctx, id);
}
