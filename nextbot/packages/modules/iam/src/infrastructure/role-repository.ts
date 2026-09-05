import { and, eq, inArray, notInArray } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { PermissionMatrix } from "@nextbot/contracts";

export interface RoleRow {
  id: string;
  tenantId: string;
  name: string;
  isSystem: boolean;
  permissionMatrix: PermissionMatrix;
  /** QA Defect B3 (FR-SEC-03/ADR-0002 §4.2): true if any user assigned this role
   * must complete MFA enrollment before/immediately upon first login. */
  mfaRequired: boolean;
}

/** Lists every role for a tenant. */
export async function listRoles(ctx: TenantContext): Promise<RoleRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.role).where(eq(schema.role.tenantId, ctx.tenantId));
    return rows.map((r) => ({ ...r, permissionMatrix: r.permissionMatrix as PermissionMatrix }));
  });
}

/** Finds a role by (tenant-scoped) name, or `null`. */
export async function findRoleByName(ctx: TenantContext, name: string): Promise<RoleRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.role)
      .where(and(eq(schema.role.tenantId, ctx.tenantId), eq(schema.role.name, name)));
    const row = rows[0];
    return row ? { ...row, permissionMatrix: row.permissionMatrix as PermissionMatrix } : null;
  });
}

/** Inserts a new role, returning its id. */
export async function insertRole(
  ctx: TenantContext,
  input: { name: string; permissionMatrix: PermissionMatrix; isSystem?: boolean; mfaRequired?: boolean },
): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.role).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      isSystem: input.isSystem ?? false,
      permissionMatrix: input.permissionMatrix,
      mfaRequired: input.mfaRequired ?? false,
    });
  });
  return id;
}

/** A grant's origin (LLD/schema `user_role.source`, added Phase 4 retry — QA
 * `20260829-054900` Finding 1): `Manual` for an admin-console/SCIM/service-account
 * grant, `Sso` for one `syncSsoRoleAssignment` derived from an IdP group assertion. */
export type UserRoleSource = "Manual" | "Sso";

/** Assigns a role to a user (idempotent: a duplicate `(tenant, user, role)` insert is
 * a no-op via `onConflictDoNothing`, since the composite key already prevents dupes).
 * `source` defaults to `Manual` — every pre-existing caller (console invite/register)
 * is an intentional administrative grant, not an SSO-derived one. */
export async function assignRoleToUser(ctx: TenantContext, userId: string, roleId: string, source: UserRoleSource = "Manual"): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .insert(schema.userRole)
      .values({ tenantId: ctx.tenantId, userId, roleId, source })
      .onConflictDoNothing();
  });
}

/** Assigns multiple roles to a user in one round trip (invite/create-user/SCIM/
 * service-account flows) — same idempotent `onConflictDoNothing` semantics as
 * `assignRoleToUser`, `source` defaulting to `Manual` for the same reason. */
export async function assignRolesToUser(ctx: TenantContext, userId: string, roleIds: string[], source: UserRoleSource = "Manual"): Promise<void> {
  if (roleIds.length === 0) return;
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .insert(schema.userRole)
      .values(roleIds.map((roleId) => ({ tenantId: ctx.tenantId, userId, roleId, source })))
      .onConflictDoNothing();
  });
}

/**
 * Re-derives a user's SSO-sourced role set to EXACTLY match `roleIds` — the fix for
 * QA `20260829-054900` Finding 1 (SSO login was calling the additive
 * `assignRolesToUser`, which never retracts a role the IdP no longer asserts).
 *
 * Deliberately scoped to rows with `source = 'Sso'` only: a role an admin granted
 * through the Users & Roles console (or SCIM, or a service-account grant — all
 * `source = 'Manual'`) is NEVER removed by this function, even if the current IdP
 * assertion doesn't happen to map to it. Only a role THIS function itself previously
 * granted (because a past login's group assertion mapped to it) is eligible for
 * removal on a later login where that mapping no longer holds. This is what makes
 * "re-derive fresh every login" safe: it re-derives SSO's own prior work, not the
 * whole user.
 *
 * Deliberately refuses to shrink the SSO-sourced set to zero (`roleIds` empty): a
 * misconfigured or momentarily-empty IdP group claim must not silently strip every
 * SSO-derived permission a user has — that would be a self-inflicted, IdP-side
 * denial-of-service on top of the very bug this function fixes. Instead this is a
 * no-op (existing grants — SSO- or manually-sourced — are left exactly as they are)
 * and a warning is logged for an operator to investigate; if the resolved user
 * genuinely has zero roles for an unrelated reason, the existing FR-ADM-02 zero-role
 * login rejection (`AuthNoRoleAssignedError`) in `sso-login.ts` still applies as
 * normal — this function does not need to special-case that outcome itself.
 */
export async function syncSsoRoleAssignment(ctx: TenantContext, userId: string, roleIds: string[]): Promise<void> {
  if (roleIds.length === 0) {
    console.warn(
      `[iam] syncSsoRoleAssignment: IdP assertion for user ${userId} in tenant ${ctx.tenantId} mapped to zero roles this login — refusing to remove any existing SSO-derived role grant to avoid a misconfiguration lockout. Investigate this tenant's sso_group_mapping / defaultRoleId configuration.`,
    );
    return;
  }
  await withTenant(ctx, async (db: TenantScopedClient) => {
    // Retract only SSO-derived roles the current assertion no longer maps to —
    // a Manual (console/SCIM/service-account) grant is excluded by the source
    // filter and is never touched here.
    await db
      .delete(schema.userRole)
      .where(
        and(
          eq(schema.userRole.tenantId, ctx.tenantId),
          eq(schema.userRole.userId, userId),
          eq(schema.userRole.source, "Sso"),
          notInArray(schema.userRole.roleId, roleIds),
        ),
      );
    // Grant every currently-asserted role. A role already present for this user
    // (whether previously Sso- or Manual-sourced) is left untouched by
    // onConflictDoNothing — in particular, a role an admin already granted
    // manually keeps its Manual source rather than being silently reclassified.
    await db
      .insert(schema.userRole)
      .values(roleIds.map((roleId) => ({ tenantId: ctx.tenantId, userId, roleId, source: "Sso" as const })))
      .onConflictDoNothing();
  });
}

/** Finds a role by id, or `null`. */
export async function findRoleById(ctx: TenantContext, roleId: string): Promise<RoleRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.role)
      .where(and(eq(schema.role.tenantId, ctx.tenantId), eq(schema.role.id, roleId)));
    const row = rows[0];
    return row ? { ...row, permissionMatrix: row.permissionMatrix as PermissionMatrix } : null;
  });
}

/**
 * Resolves a set of role ids to `RoleRow`s scoped to the tenant — used to validate a
 * caller-supplied `roleIds` array (create-user / reassign-roles flows) actually
 * belongs to this tenant before assigning, never trusting a client-supplied id blindly.
 */
export async function findRolesByIds(ctx: TenantContext, roleIds: string[]): Promise<RoleRow[]> {
  if (roleIds.length === 0) return [];
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.role)
      .where(and(eq(schema.role.tenantId, ctx.tenantId), inArray(schema.role.id, roleIds)));
    return rows.map((r) => ({ ...r, permissionMatrix: r.permissionMatrix as PermissionMatrix }));
  });
}

/**
 * Updates a *non-system* role's name/matrix/MFA flag. The `isSystem: false` clause in
 * the `WHERE` is defense-in-depth (the application layer already rejects an edit
 * attempt on a system role with a typed `SystemRoleImmutableError` before this is
 * ever called) — if somehow bypassed, this silently affects 0 rows for a system role
 * rather than mutating it.
 */
export async function updateRole(
  ctx: TenantContext,
  roleId: string,
  input: { name: string; permissionMatrix: PermissionMatrix; mfaRequired?: boolean },
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.role)
      .set({
        name: input.name,
        permissionMatrix: input.permissionMatrix,
        mfaRequired: input.mfaRequired ?? false,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.role.tenantId, ctx.tenantId), eq(schema.role.id, roleId), eq(schema.role.isSystem, false)));
  });
}

/**
 * Replaces a user's entire role assignment set (delete-then-insert, atomic since
 * `withTenant` already wraps its callback in one transaction — LLD §3.2). Used by the
 * "change this user's role(s)" reassignment action, not incremental add/remove.
 */
export async function replaceUserRoles(ctx: TenantContext, userId: string, roleIds: string[]): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .delete(schema.userRole)
      .where(and(eq(schema.userRole.tenantId, ctx.tenantId), eq(schema.userRole.userId, userId)));
    if (roleIds.length > 0) {
      await db.insert(schema.userRole).values(roleIds.map((roleId) => ({ tenantId: ctx.tenantId, userId, roleId })));
    }
  });
}
