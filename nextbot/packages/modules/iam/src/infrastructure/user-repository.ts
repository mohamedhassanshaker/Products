import { and, eq, gte, ne } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { PermissionMatrix } from "@nextbot/contracts";

/**
 * `TenantContext.environment` is meaningless for IAM entities (users/roles aren't
 * Sandbox/Staging/Production-scoped) but the primitive requires one — `Production` is
 * used as a fixed technical placeholder for every `withTenant` call this module makes,
 * documented here once rather than repeated at each call site.
 */
export function iamTenantContext(tenantId: string, region: TenantContext["region"]): TenantContext {
  return { tenantId, region, environment: "Production" };
}

export interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string | null;
  displayName: string;
  status: "Active" | "Locked" | "Disabled" | "Invited";
  kind: "Human" | "ServiceAccount";
  mfaEnrolled: boolean;
  mfaMethod: "Totp" | "Sms" | "Email" | null;
  mfaSecretRef: string | null;
  /** QA Defect B2: JSON-serialized hashed backup codes — see `mfa-backup-codes.ts`. */
  mfaBackupCodesRef: string | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

/** Finds a user by (tenant-scoped) email, or `null`. */
export async function findUserByEmail(ctx: TenantContext, email: string): Promise<UserRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.email, email)));
    return rows[0] ?? null;
  });
}

/** Finds a user by id, or `null`. */
export async function findUserById(ctx: TenantContext, userId: string): Promise<UserRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.id, userId)));
    return rows[0] ?? null;
  });
}

/** A user row plus its assigned roles — the "Users & Roles" screen's user table shape
 * (FR-ADM-02 / screen inventory B.8.1: name, email, role(s), last login, MFA status). */
export interface UserWithRoles {
  id: string;
  email: string;
  displayName: string;
  status: UserRow["status"];
  lastLoginAt: Date | null;
  mfaEnrolled: boolean;
  roles: Array<{ id: string; name: string }>;
}

/**
 * Lists every user for the tenant with their assigned roles attached. Two queries
 * (users, then every `user_role` join row for the tenant) composed in application
 * code rather than one wide join, so a user with zero roles (possible pre-QA-fix
 * data, or a role removed mid-edit) still appears exactly once with an empty `roles`
 * array instead of being dropped by an inner join.
 */
export async function listUsersWithRoles(ctx: TenantContext): Promise<UserWithRoles[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const users = await db
      .select()
      .from(schema.appUser)
      .where(eq(schema.appUser.tenantId, ctx.tenantId));

    const roleRows = await db
      .select({ userId: schema.userRole.userId, roleId: schema.role.id, roleName: schema.role.name })
      .from(schema.userRole)
      .innerJoin(schema.role, eq(schema.userRole.roleId, schema.role.id))
      .where(eq(schema.userRole.tenantId, ctx.tenantId));

    const rolesByUser = new Map<string, Array<{ id: string; name: string }>>();
    for (const row of roleRows) {
      const list = rolesByUser.get(row.userId) ?? [];
      list.push({ id: row.roleId, name: row.roleName });
      rolesByUser.set(row.userId, list);
    }

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      mfaEnrolled: u.mfaEnrolled,
      roles: rolesByUser.get(u.id) ?? [],
    }));
  });
}

/**
 * Returns the effective (merged) permission matrix, role ids, and whether *any*
 * assigned role flags MFA as required (QA Defect B3, FR-SEC-03/ADR-0002 §4.2) for a
 * user.
 */
export async function getUserRolesAndMatrix(
  ctx: TenantContext,
  userId: string,
): Promise<{ roleIds: string[]; matrices: PermissionMatrix[]; mfaRequired: boolean }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({
        roleId: schema.role.id,
        permissionMatrix: schema.role.permissionMatrix,
        mfaRequired: schema.role.mfaRequired,
      })
      .from(schema.userRole)
      .innerJoin(schema.role, eq(schema.userRole.roleId, schema.role.id))
      .where(and(eq(schema.userRole.tenantId, ctx.tenantId), eq(schema.userRole.userId, userId)));
    return {
      roleIds: rows.map((r) => r.roleId),
      matrices: rows.map((r) => r.permissionMatrix as PermissionMatrix),
      mfaRequired: rows.some((r) => r.mfaRequired),
    };
  });
}

/** Updates lockout bookkeeping columns after a failed login attempt. */
export async function updateLockoutState(
  ctx: TenantContext,
  userId: string,
  state: { failedLoginCount: number; lockedUntil: Date | null },
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.appUser)
      .set({ failedLoginCount: state.failedLoginCount, lockedUntil: state.lockedUntil, updatedAt: new Date() })
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.id, userId)));
  });
}

/** Clears lockout state and stamps `last_login_at` after a fully successful login. */
export async function recordSuccessfulLogin(ctx: TenantContext, userId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.appUser)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.id, userId)));
  });
}

/**
 * Appends a `login_attempt` row (LLD §3.3). Always requires a resolved
 * `TenantContext` — the unresolved-tenant/unresolved-email path is handled by the
 * application layer via `@nextbot/tenancy`'s platform-only resolution, not here.
 */
export async function insertLoginAttempt(
  ctx: TenantContext,
  input: {
    email: string;
    outcome: "Success" | "BadCredentials" | "Locked" | "NoRole" | "MfaFailed" | "SsoFailed";
    ip?: string;
    userAgent?: string;
  },
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.loginAttempt).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      email: input.email,
      outcome: input.outcome,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  });
}

/** Counts failed attempts against `login_attempt` since `since` (audit cross-check,
 * independent of the `app_user.failed_login_count` running counter). */
export async function countRecentFailedAttempts(ctx: TenantContext, email: string, since: Date): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ id: schema.loginAttempt.id })
      .from(schema.loginAttempt)
      .where(
        and(
          eq(schema.loginAttempt.tenantId, ctx.tenantId),
          eq(schema.loginAttempt.email, email),
          ne(schema.loginAttempt.outcome, "Success"),
          gte(schema.loginAttempt.createdAt, since),
        ),
      );
    return rows.length;
  });
}

/** Fetches a tenant's lockout policy row, or `null` if not yet configured (caller
 * falls back to `DEFAULT_LOCKOUT_POLICY`). */
export async function getLockoutPolicy(
  ctx: TenantContext,
): Promise<{ maxFailedAttempts: number; cooldownMinutes: number } | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ maxFailedAttempts: schema.loginLockoutPolicy.maxFailedAttempts, cooldownMinutes: schema.loginLockoutPolicy.cooldownMinutes })
      .from(schema.loginLockoutPolicy)
      .where(eq(schema.loginLockoutPolicy.tenantId, ctx.tenantId));
    return rows[0] ?? null;
  });
}

/** Inserts a new user (registration/invite flow). */
export async function insertUser(
  ctx: TenantContext,
  input: { email: string; passwordHash: string | null; displayName: string; status?: UserRow["status"]; ssoSubject?: string },
): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.appUser).values({
      id,
      tenantId: ctx.tenantId,
      email: input.email,
      passwordHash: input.passwordHash,
      ssoSubject: input.ssoSubject,
      displayName: input.displayName,
      status: input.status ?? "Active",
    });
  });
  return id;
}

/** Finds a user by their SSO subject (the IdP-asserted `sub`/`NameID`), scoped to
 * the tenant — the JIT-provisioning and existing-account-linking lookup key for
 * every subsequent SSO login (Phase 4, BL-36). */
export async function findUserBySsoSubject(ctx: TenantContext, ssoSubject: string): Promise<UserRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.ssoSubject, ssoSubject)));
    return rows[0] ?? null;
  });
}

/** Links an existing (previously password/invite-created) user to an IdP
 * identity on their first successful SSO login when JIT provisioning is
 * disabled — see README decision #1. */
export async function linkSsoSubject(ctx: TenantContext, userId: string, ssoSubject: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.appUser)
      .set({ ssoSubject, updatedAt: new Date() })
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.id, userId)));
  });
}

/**
 * Inserts a `ServiceAccount`-kind user (Phase 4, BL-36, FR-SEC-10) — a
 * programmatic-access-only identity with no password/SSO subject, reusing
 * `app_user`/`user_role`/the RBAC matrix exactly like a human user (README
 * decision #6). Its "email" is a synthetic, tenant-unique placeholder (service
 * accounts don't have a real mailbox) so the existing `(tenant_id, email)`
 * uniqueness constraint keeps working unmodified.
 */
export async function insertServiceAccount(ctx: TenantContext, input: { name: string }): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.appUser).values({
      id,
      tenantId: ctx.tenantId,
      email: `service-account+${id}@service.internal`,
      passwordHash: null,
      displayName: input.name,
      status: "Active",
      kind: "ServiceAccount",
    });
  });
  return id;
}

/** Lists every service account for the tenant with its assigned roles — mirrors
 * `listUsersWithRoles` but filtered to `kind = 'ServiceAccount'`. */
export async function listServiceAccountsWithRoles(ctx: TenantContext): Promise<UserWithRoles[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const accounts = await db
      .select()
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.kind, "ServiceAccount")));

    const roleRows = await db
      .select({ userId: schema.userRole.userId, roleId: schema.role.id, roleName: schema.role.name })
      .from(schema.userRole)
      .innerJoin(schema.role, eq(schema.userRole.roleId, schema.role.id))
      .where(eq(schema.userRole.tenantId, ctx.tenantId));

    const rolesByUser = new Map<string, Array<{ id: string; name: string }>>();
    for (const row of roleRows) {
      const list = rolesByUser.get(row.userId) ?? [];
      list.push({ id: row.roleId, name: row.roleName });
      rolesByUser.set(row.userId, list);
    }

    return accounts.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      mfaEnrolled: u.mfaEnrolled,
      roles: rolesByUser.get(u.id) ?? [],
    }));
  });
}

/** Updates a user's display name (SCIM `PUT` full-replace semantics — Phase 4,
 * BL-36). */
export async function updateUserDisplayName(ctx: TenantContext, userId: string, displayName: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.appUser)
      .set({ displayName, updatedAt: new Date() })
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.id, userId)));
  });
}

/** Sets a user's `status` — used both for the SCIM `active: false` deactivation
 * path and the service-account "disable" action. Deliberately never deletes the
 * row (README decision #7). */
export async function setUserStatus(ctx: TenantContext, userId: string, status: UserRow["status"]): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.appUser)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.id, userId)));
  });
}

/** Sets a user's TOTP enrollment pointer (never the plaintext secret — `mfaSecretRef`
 * is a `SecretsProvider` vault_ref pointer, per LLD's `app_user.mfa_secret_ref` doc). */
export async function enrollMfa(ctx: TenantContext, userId: string, mfaSecretRef: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.appUser)
      .set({ mfaEnrolled: true, mfaMethod: "Totp", mfaSecretRef, updatedAt: new Date() })
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.id, userId)));
  });
}

/** QA Defect B2: persists the serialized (hashed) backup-code set for a user. */
export async function setBackupCodesRef(ctx: TenantContext, userId: string, serialized: string | null): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.appUser)
      .set({ mfaBackupCodesRef: serialized, updatedAt: new Date() })
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.id, userId)));
  });
}

/** QA Defect B2: reads the serialized (hashed) backup-code set for a user, or `null`
 * if none have been generated. */
export async function getBackupCodesRef(ctx: TenantContext, userId: string): Promise<string | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ mfaBackupCodesRef: schema.appUser.mfaBackupCodesRef })
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.id, userId)));
    return rows[0]?.mfaBackupCodesRef ?? null;
  });
}

/**
 * QA Defect B2: admin-side "reset this user's MFA" action — clears enrollment state
 * entirely (enrolled flag, method, secret pointer, backup codes) so a user locked out
 * with no remaining backup codes and no access to their authenticator app isn't
 * permanently stuck; they simply re-enroll (or are forced to again, if their role
 * still requires it) on next login. Does not touch lockout/password state.
 */
export async function resetMfaEnrollment(ctx: TenantContext, userId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.appUser)
      .set({ mfaEnrolled: false, mfaMethod: null, mfaSecretRef: null, mfaBackupCodesRef: null, updatedAt: new Date() })
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.id, userId)));
  });
}
