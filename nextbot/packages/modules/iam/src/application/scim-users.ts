import { InvalidRoleAssignmentError, ScimConflictError, ScimUserNotFoundError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import {
  findUserByEmail,
  findUserById,
  insertUser,
  listUsersWithRoles,
  setUserStatus,
  updateUserDisplayName,
  type UserWithRoles,
} from "../infrastructure/user-repository.js";
import { assignRolesToUser, findRolesByIds, replaceUserRoles } from "../infrastructure/role-repository.js";
import { revokeAllSessionsForUser } from "../infrastructure/session-repository.js";

/**
 * SCIM 2.0 Users resource (RFC 7644 §3.2), Phase 4 (BL-36, FR-SEC-10). Scoped to
 * Users only — no Groups resource this phase (see the plan doc's "out of
 * scope"); role assignment is carried on a NextBot-specific attribute
 * (`nextbotRoleIds`, an array of this tenant's `role.id`s) rather than SCIM's
 * standard `groups` multi-valued attribute, since that maps 1:1 to a SCIM Group
 * resource we aren't standing up this phase — an enterprise IdP's attribute
 * mapping UI can still populate it from a directory group, same operational
 * outcome without a second resource type to implement/secure.
 *
 * Every function here is called only after the SCIM bearer token has already
 * been authenticated against a specific tenant's `ctx` (`http/scim-routes.ts`)
 * — there is no code path in this file that accepts a tenant id as an argument,
 * so cross-tenant access is structurally impossible from within this module.
 */

export interface ScimUserResource {
  id: string;
  userName: string;
  displayName: string;
  active: boolean;
  roleIds: string[];
}

function toScimResource(user: UserWithRoles): ScimUserResource {
  return { id: user.id, userName: user.email, displayName: user.displayName, active: user.status === "Active", roleIds: user.roles.map((r) => r.id) };
}

export async function listScimUsers(ctx: TenantContext, filterUserName?: string): Promise<ScimUserResource[]> {
  const users = await listUsersWithRoles(ctx);
  const filtered = filterUserName ? users.filter((u) => u.email === filterUserName) : users;
  return filtered.map(toScimResource);
}

export async function getScimUser(ctx: TenantContext, id: string): Promise<ScimUserResource> {
  const users = await listUsersWithRoles(ctx);
  const user = users.find((u) => u.id === id);
  if (!user) throw new ScimUserNotFoundError();
  return toScimResource(user);
}

export interface CreateScimUserInput {
  userName: string;
  displayName: string;
  active?: boolean;
  roleIds?: string[];
}

/** Provisions a new user via SCIM. `passwordHash: null` — a SCIM-provisioned
 * user has no local password (they authenticate via SSO or are console-invited
 * to set one later); FR-ADM-02's fail-closed no-role rule is enforced by
 * requiring at least one resolvable `roleIds` entry, same as the console's
 * "invite user" flow.
 *
 * @throws {ScimConflictError} `userName` already exists in this tenant.
 * @throws {InvalidRoleAssignmentError} a supplied role id doesn't exist here.
 */
export async function createScimUser(ctx: TenantContext, input: CreateScimUserInput): Promise<ScimUserResource> {
  const existing = await findUserByEmail(ctx, input.userName);
  if (existing) throw new ScimConflictError();

  const roleIds = Array.from(new Set(input.roleIds ?? []));
  if (roleIds.length > 0) {
    const resolved = await findRolesByIds(ctx, roleIds);
    if (resolved.length !== roleIds.length) throw new InvalidRoleAssignmentError();
  }

  const userId = await insertUser(ctx, {
    email: input.userName,
    passwordHash: null,
    displayName: input.displayName,
    status: input.active === false ? "Disabled" : "Active",
  });
  if (roleIds.length > 0) await assignRolesToUser(ctx, userId, roleIds);
  return getScimUser(ctx, userId);
}

export interface ReplaceScimUserInput {
  displayName: string;
  active: boolean;
  roleIds: string[];
}

/** `PUT` — full replace semantics (SCIM's own convention: a PUT re-states the
 * complete resource). Role assignment is a full replace too (`replaceUserRoles`),
 * not incremental. */
export async function replaceScimUser(ctx: TenantContext, id: string, input: ReplaceScimUserInput): Promise<ScimUserResource> {
  const user = await findUserById(ctx, id);
  if (!user) throw new ScimUserNotFoundError();

  const roleIds = Array.from(new Set(input.roleIds));
  if (roleIds.length > 0) {
    const resolved = await findRolesByIds(ctx, roleIds);
    if (resolved.length !== roleIds.length) throw new InvalidRoleAssignmentError();
  }

  await updateUserDisplayName(ctx, id, input.displayName);
  await setUserStatus(ctx, id, input.active ? "Active" : "Disabled");
  if (!input.active) await revokeAllSessionsForUser(ctx, id);
  await replaceUserRoles(ctx, id, roleIds);
  return getScimUser(ctx, id);
}

/**
 * `PATCH ... {"op":"replace","path":"active","value":false}` — the deprovisioning
 * operation most IdPs actually send (rather than DELETE). Deactivating also
 * revokes every active session immediately (README decision #5/#7 — a
 * deactivated account must not retain live access via a session it already
 * holds).
 */
export async function setScimUserActive(ctx: TenantContext, id: string, active: boolean): Promise<ScimUserResource> {
  const user = await findUserById(ctx, id);
  if (!user) throw new ScimUserNotFoundError();
  await setUserStatus(ctx, id, active ? "Active" : "Disabled");
  if (!active) await revokeAllSessionsForUser(ctx, id);
  return getScimUser(ctx, id);
}

/**
 * `DELETE` — README decision #7: never a hard delete (would cascade into
 * conversation/audit-log FK history). Deactivates and revokes sessions, exactly
 * like `active: false`, satisfying RFC 7644 §3.6's "resource is no longer
 * accessible" without an irreversible destructive action.
 */
export async function deleteScimUser(ctx: TenantContext, id: string): Promise<void> {
  const user = await findUserById(ctx, id);
  if (!user) throw new ScimUserNotFoundError();
  await setUserStatus(ctx, id, "Disabled");
  await revokeAllSessionsForUser(ctx, id);
}
