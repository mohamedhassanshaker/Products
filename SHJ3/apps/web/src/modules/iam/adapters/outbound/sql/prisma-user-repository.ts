/**
 * The real `UserRepository` — the first SQL adapter this port has ever had.
 *
 * Confirmed by grep before writing a line of this file: every other file under
 * `modules/iam/adapters/outbound/` (`local-password-provider.ts`, `redis-session-store.ts`,
 * `totp.ts`, `mock-verification-provider.ts`) is real, but nothing implemented this port —
 * only `testing/fakes.ts`'s in-memory double, which every existing `sign-in`/`resolve-
 * session`/`suspend-user` test runs against. `LocalPasswordProvider` (ADR-0006's real local
 * identity adapter) has been fully built and tested against that fake since a previous
 * wave; this file is what lets it — and B-2's own invite/edit/list/remove use cases — run
 * against a live database for the first time.
 *
 * ## Two schemas, one repository
 *
 * `StaffUser`/`TenantMembership` live in `platform` (ADR-0006 rule 3: identity is global —
 * one email is one account across every tenant). `UserRoleAssignment`/`Role`/`RolePermission`
 * live per-tenant (ADR-0011). So `rolesFor`/`permissionMatrix`/`setRoleAssignments` reach
 * `getTenantDb()` and everything else reaches `getPlatformDb()` — never a new client for
 * either (ADR-0002 rule 3).
 *
 * `getTenantDb()` reads its schema from the *ambient* bound tenant, not from a method's own
 * `tenant` parameter — so every such call site must already be running inside
 * `runWithTenant({ tenant, ... })` for that same `tenant`. That invariant already holds for
 * every real caller (`AuthMiddleware.handle()` binds `principal.tenant` before its handler
 * runs); `assertMatchesAmbientTenant` turns a future violation into a loud, immediate error
 * instead of a silently wrong-schema read.
 *
 * ## `getPlatformDb()`'s `"identity"` scope
 *
 * Every method here that touches `platform.StaffUsers`/`TenantMemberships` needs
 * `getPlatformDb()`, which requires `TenantContext.platformScope` to be set (ADR-0002 rule
 * 5). Staff-identity reads happen on *every* authenticated request, not as a rare bulk
 * operation — see `tenant-context.ts`'s own doc comment on the `"identity"` scope value
 * added for this wave, and `auth-middleware.ts`'s two `runWithTenant` calls, which set it.
 *
 * ## "Remove" ≠ a global soft-delete
 *
 * See `user-repository.ts`'s own module comment for why `revokeTenantMembership` touches
 * `TenantMemberships.revokedAt`, never `StaffUsers.deletedAt`.
 */

import {
  buildPlatformAuditCall,
  buildTenantAuditCall,
} from "../../../../platform/adapters/outbound/sql/audit-sink.js";
import { safeSchemaName } from "../../../../platform/adapters/outbound/sql/sql-script.js";
import {
  getPlatformDb,
  getTenantDb,
} from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  currentTenant,
  requireTenantContext,
} from "../../../../platform/tenancy/tenant-context.js";
import { assertValidSlugShape, type TenantSlug } from "../../../../platform/tenancy/tenant-slug.js";
import { isPermission, type Permission } from "../../../domain/permissions.js";
import type { AuditEntry } from "../../../../platform/ports/provisioning.js";
import type {
  AuditContext,
  AuditedStatusChange,
  NewStaffUser,
  ProfileEdit,
  StaffUser,
  StaffUserStatus,
  UserRepository,
} from "../../../ports/user-repository.js";

const OPERATION = "iam user repository";

/** `StaffUsers` row shape this file reads, whichever query produced it. */
interface StaffUserRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: string;
  readonly sessionEpoch: number;
  readonly homeTenant: { readonly slug: string };
}

function toDomainUser(row: StaffUserRow): StaffUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    // `CK_StaffUsers_status` is the real guarantee behind this cast (§4.2) — the same
    // "an enum-shaped column backed by a CHECK constraint" pattern `tenant-registry.ts`'s
    // `row.status as TenantStatus` already uses for `platform.Tenants.status`.
    status: row.status as StaffUserStatus,
    homeTenant: assertValidSlugShape(row.homeTenant.slug),
    sessionEpoch: row.sessionEpoch,
  };
}

const STAFF_USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  sessionEpoch: true,
  homeTenant: { select: { slug: true } },
} as const;

/** Asserts the explicit `tenant` argument matches the ambient bound one — see the module comment. */
function assertMatchesAmbientTenant(tenant: TenantSlug, operation: string): void {
  const ambient = currentTenant(operation);
  if (ambient !== tenant) {
    throw new Error(
      `${operation}: called for tenant "${tenant}" but the ambient bound tenant is "${ambient}". ` +
        "getTenantDb() resolves the schema from the ambient context, not this argument — the " +
        "caller must run inside runWithTenant({ tenant, ... }) for the same tenant it passes here.",
    );
  }
}

/**
 * Every write method below needs a *full* audit actor snapshot (displayName, roles), which
 * `AuditContext`/`AuditedStatusChange.audit` deliberately carry only as a bare `actorId`
 * string (see that interface's own doc comment). Reading it from the ambient bound
 * principal avoids a second query — this asserts that principal really is the actor the
 * caller named, converting a future mismatch into a loud, immediate error rather than a
 * silently mis-attributed audit entry.
 */
function actorPrincipal(actorId: string, operation: string) {
  const { principal } = requireTenantContext(operation);
  if (!principal || principal.id !== actorId) {
    throw new Error(
      `${operation}: audit.actorId ("${actorId}") does not match the ambient bound principal ` +
        `("${principal?.id ?? "none"}"). The caller must run inside the authenticated actor's own request context.`,
    );
  }
  return principal;
}

export class PrismaUserRepository implements UserRepository {
  async findByEmail(email: string): Promise<StaffUser | null> {
    const db = getPlatformDb(OPERATION);
    const row = await db.staffUser.findFirst({
      // `email` has no Prisma-recognised unique constraint: `UQ_StaffUsers_email` is a
      // FILTERED index (`WHERE deletedAt IS NULL`, prisma/sql/001_constraints.sql §1.1),
      // which Prisma's schema-level `@unique` cannot express — so `findFirst`, not
      // `findUnique`. The same filter is applied here explicitly.
      where: { email: email.trim().toLowerCase(), deletedAt: null },
      select: STAFF_USER_SELECT,
    });
    return row ? toDomainUser(row) : null;
  }

  async findById(staffUserId: string): Promise<StaffUser | null> {
    const db = getPlatformDb(OPERATION);
    const row = await db.staffUser.findFirst({
      where: { id: staffUserId, deletedAt: null },
      select: STAFF_USER_SELECT,
    });
    return row ? toDomainUser(row) : null;
  }

  async rolesFor(staffUserId: string, tenant: TenantSlug): Promise<readonly string[]> {
    assertMatchesAmbientTenant(tenant, OPERATION);
    const db = getTenantDb(OPERATION);
    const assignments = await db.userRoleAssignment.findMany({
      where: { staffUserId },
      select: { role: { select: { key: true, deletedAt: true } } },
    });
    // A deleted role contributes nothing — deny by default (domain/permissions.ts), not an
    // error. `permissionMatrix()` below would already exclude it; filtered here too so this
    // method's own contract ("the roles this user holds") never names a role that is gone.
    return assignments.filter((a) => a.role.deletedAt === null).map((a) => a.role.key);
  }

  async permissionMatrix(
    tenant: TenantSlug,
  ): Promise<Readonly<Record<string, readonly Permission[]>>> {
    assertMatchesAmbientTenant(tenant, OPERATION);
    const db = getTenantDb(OPERATION);
    const roles = await db.role.findMany({
      where: { deletedAt: null },
      select: { key: true, permissions: { select: { permissionKey: true } } },
    });

    const matrix: Record<string, readonly Permission[]> = {};
    for (const role of roles) {
      matrix[role.key] = role.permissions.map((p) => p.permissionKey).filter(isPermission);
    }
    return matrix;
  }

  async membershipsFor(staffUserId: string): Promise<readonly TenantSlug[]> {
    const db = getPlatformDb(OPERATION);
    const rows = await db.tenantMembership.findMany({
      where: { staffUserId, revokedAt: null },
      select: { tenant: { select: { slug: true } } },
    });
    return rows.map((row) => assertValidSlugShape(row.tenant.slug));
  }

  /**
   * Status change and its audit entry, in one transaction (api.md §12 invariant 3,
   * `AuditedStatusChange`'s own doc comment).
   *
   * Both statements run through `getPlatformDb()`'s *same* client instance — `staffUser.update`
   * (typed) and the audit `EXEC` (raw, via the exact hash-chain-computing stored procedure
   * `PlatformAuditSink` itself calls, reused via the exported `buildPlatformAuditCall` rather
   * than reimplemented) — which is what makes `db.$transaction([...])` actually atomic here.
   * `TenantAuditSink` was considered and rejected: it writes through `getTenantDb()`, a
   * *different* Prisma client/connection, and a transaction cannot span two client instances —
   * using it would have silently given up the "one transaction" guarantee this method exists
   * to provide.
   */
  async changeStatus(change: AuditedStatusChange): Promise<void> {
    const db = getPlatformDb(OPERATION);
    const context = requireTenantContext(OPERATION);
    const principal = actorPrincipal(change.audit.actorId, OPERATION);

    const entry: AuditEntry = {
      actor: { kind: "Principal", principal },
      action: change.audit.action,
      target: { kind: "StaffUser", id: change.staffUserId, labelSnapshot: change.staffUserId },
      summary: `Staff user ${change.staffUserId} status changed to ${change.status} (${change.audit.action}).`,
      environmentKey: change.audit.environment,
      after: { status: change.status, ...change.audit.detail },
    };
    const auditCall = buildPlatformAuditCall(entry, context.traceId);

    await db.$transaction([
      db.staffUser.update({
        where: { id: change.staffUserId },
        data: { status: change.status, updatedAt: change.at },
      }),
      db.$executeRawUnsafe(auditCall.sql, ...auditCall.params),
    ]);
  }

  async bumpSessionEpoch(staffUserId: string): Promise<number> {
    const db = getPlatformDb(OPERATION);
    const now = new Date();
    const row = await db.staffUser.update({
      where: { id: staffUserId },
      data: { sessionEpoch: { increment: 1 }, updatedAt: now },
      select: { sessionEpoch: true },
    });
    return row.sessionEpoch;
  }

  async recordSuccessfulLogin(staffUserId: string, at: Date): Promise<void> {
    const db = getPlatformDb(OPERATION);
    await db.staffUser.update({
      where: { id: staffUserId },
      data: { lastLoginAt: at, updatedAt: at },
    });
  }

  // ---------------------------------------------------------------------------------
  // B-2 additions
  // ---------------------------------------------------------------------------------

  async listForTenant(tenant: TenantSlug): Promise<readonly StaffUser[]> {
    const db = getPlatformDb(OPERATION);
    const rows = await db.tenantMembership.findMany({
      where: { revokedAt: null, tenant: { slug: tenant } },
      select: { staffUser: { select: STAFF_USER_SELECT } },
      orderBy: { staffUser: { displayName: "asc" } },
    });
    return rows.map((row) => toDomainUser(row.staffUser));
  }

  async create(input: NewStaffUser, tenant: TenantSlug): Promise<StaffUser> {
    const db = getPlatformDb(OPERATION);
    const email = input.email.trim().toLowerCase();
    const tenantRow = await db.tenant.findUniqueOrThrow({
      where: { slug: tenant },
      select: { id: true },
    });

    const existing = await db.staffUser.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      const membership = await db.tenantMembership.findFirst({
        where: { staffUserId: existing.id, tenantId: tenantRow.id },
      });
      if (!membership) {
        const hasAnyMembership = await db.tenantMembership.count({
          where: { staffUserId: existing.id, revokedAt: null },
        });
        await db.tenantMembership.create({
          data: {
            id: newUlid(input.at),
            staffUserId: existing.id,
            tenantId: tenantRow.id,
            isPrimary: hasAnyMembership === 0,
            grantedByStaffUserId: input.invitedByStaffUserId,
            grantedAt: input.at,
            createdAt: input.at,
            updatedAt: input.at,
          },
        });
      } else if (membership.revokedAt !== null) {
        await db.tenantMembership.update({
          where: { id: membership.id },
          data: {
            revokedAt: null,
            grantedByStaffUserId: input.invitedByStaffUserId,
            grantedAt: input.at,
            updatedAt: input.at,
          },
        });
      }
      const row = await db.staffUser.findUniqueOrThrow({
        where: { id: existing.id },
        select: STAFF_USER_SELECT,
      });
      return toDomainUser(row);
    }

    const id = newUlid(input.at);
    await db.$transaction([
      db.staffUser.create({
        data: {
          id,
          email,
          displayName: input.displayName,
          status: "Invited",
          homeTenantId: tenantRow.id,
          invitedByStaffUserId: input.invitedByStaffUserId,
          invitedAt: input.at,
          sessionEpoch: 0,
          createdAt: input.at,
          updatedAt: input.at,
        },
      }),
      db.tenantMembership.create({
        data: {
          id: newUlid(new Date(input.at.getTime() + 1)),
          staffUserId: id,
          tenantId: tenantRow.id,
          isPrimary: true,
          grantedByStaffUserId: input.invitedByStaffUserId,
          grantedAt: input.at,
          createdAt: input.at,
          updatedAt: input.at,
        },
      }),
    ]);

    const row = await db.staffUser.findUniqueOrThrow({ where: { id }, select: STAFF_USER_SELECT });
    return toDomainUser(row);
  }

  async updateProfile(
    staffUserId: string,
    edit: ProfileEdit,
    audit: AuditContext,
  ): Promise<StaffUser> {
    const db = getPlatformDb(OPERATION);
    const context = requireTenantContext(OPERATION);
    const principal = actorPrincipal(audit.actorId, OPERATION);

    const data: { displayName?: string; email?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (edit.displayName !== undefined) data.displayName = edit.displayName;
    if (edit.email !== undefined) {
      const email = edit.email.trim().toLowerCase();
      const conflict = await db.staffUser.findFirst({
        where: { email, deletedAt: null, NOT: { id: staffUserId } },
        select: { id: true },
      });
      if (conflict) {
        throw new Error(`Email "${email}" is already in use by another staff account.`);
      }
      data.email = email;
    }

    const entry: AuditEntry = {
      actor: { kind: "Principal", principal },
      action: audit.action,
      target: { kind: "StaffUser", id: staffUserId, labelSnapshot: staffUserId },
      summary: `Staff user ${staffUserId} profile updated (${audit.action}).`,
      environmentKey: audit.environment,
      after: { ...edit, ...audit.detail },
    };
    const auditCall = buildPlatformAuditCall(entry, context.traceId);

    const [updated] = await db.$transaction([
      db.staffUser.update({ where: { id: staffUserId }, data, select: STAFF_USER_SELECT }),
      db.$executeRawUnsafe(auditCall.sql, ...auditCall.params),
    ]);
    return toDomainUser(updated);
  }

  async setRoleAssignments(
    staffUserId: string,
    tenant: TenantSlug,
    roleKeys: readonly string[],
    audit: AuditContext,
  ): Promise<void> {
    assertMatchesAmbientTenant(tenant, OPERATION);
    const db = getTenantDb(OPERATION);
    const context = requireTenantContext(OPERATION);
    const principal = actorPrincipal(audit.actorId, OPERATION);

    const before = await db.userRoleAssignment.findMany({
      where: { staffUserId },
      select: { role: { select: { key: true } } },
    });
    const beforeKeys = before.map((a) => a.role.key);

    const roles = await db.role.findMany({
      where: { key: { in: [...roleKeys] }, deletedAt: null },
      select: { id: true, key: true },
    });
    const foundKeys = new Set(roles.map((r) => r.key));
    const missing = roleKeys.filter((key) => !foundKeys.has(key));
    if (missing.length > 0) {
      throw new Error(
        `Cannot assign unknown or deleted role key(s) to staff user "${staffUserId}": ${missing.join(", ")}.`,
      );
    }

    const now = new Date();
    const entry: AuditEntry = {
      actor: { kind: "Principal", principal },
      action: audit.action,
      target: { kind: "StaffUser", id: staffUserId, labelSnapshot: staffUserId },
      summary: `Role assignments for staff user ${staffUserId} changed (${audit.action}).`,
      environmentKey: audit.environment,
      before: { roleKeys: beforeKeys },
      after: { roleKeys: [...roleKeys], ...audit.detail },
    };
    const auditCall = buildTenantAuditCall(safeSchemaName(tenant), entry, context.traceId);

    await db.$transaction([
      db.userRoleAssignment.deleteMany({ where: { staffUserId } }),
      ...roles.map((role) =>
        db.userRoleAssignment.create({
          data: {
            id: newUlid(now),
            staffUserId,
            roleId: role.id,
            assignedByStaffUserId: audit.actorId,
            assignedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
      db.$executeRawUnsafe(auditCall.sql, ...auditCall.params),
    ]);
  }

  /**
   * See `user-repository.ts`'s own doc comment on this method for why it revokes
   * `TenantMembership` rather than touching `StaffUsers.deletedAt`.
   *
   * The membership revoke and its platform audit entry are one transaction (same
   * reasoning as `changeStatus`). The tenant-schema cleanup afterward
   * (`TeamMembers`/`UserRoleAssignments`) cannot join that transaction — a different
   * Prisma client/connection — so it runs best-effort and sequentially; both deletes are
   * idempotent (`deleteMany` of an already-empty set is a no-op), which is what makes a
   * partial failure here safely retryable rather than silently inconsistent, the same
   * "no distributed transaction across stores" acceptance ADR-0003 rule 4 already states
   * for cross-schema/cross-store writes generally.
   */
  async revokeTenantMembership(
    staffUserId: string,
    tenant: TenantSlug,
    audit: AuditContext,
  ): Promise<void> {
    const db = getPlatformDb(OPERATION);
    const context = requireTenantContext(OPERATION);
    const principal = actorPrincipal(audit.actorId, OPERATION);

    const tenantRow = await db.tenant.findUniqueOrThrow({
      where: { slug: tenant },
      select: { id: true },
    });
    const membership = await db.tenantMembership.findFirst({
      where: { staffUserId, tenantId: tenantRow.id, revokedAt: null },
    });
    if (!membership) {
      throw new Error(
        `Staff user "${staffUserId}" has no active membership in tenant "${tenant}" to revoke.`,
      );
    }

    const now = new Date();
    const entry: AuditEntry = {
      actor: { kind: "Principal", principal },
      action: audit.action,
      target: { kind: "StaffUser", id: staffUserId, labelSnapshot: staffUserId },
      summary: `Staff user ${staffUserId} removed from tenant "${tenant}" (${audit.action}).`,
      environmentKey: audit.environment,
      after: { revokedTenant: tenant, ...audit.detail },
    };
    const auditCall = buildPlatformAuditCall(entry, context.traceId);

    await db.$transaction([
      db.tenantMembership.update({
        where: { id: membership.id },
        data: { revokedAt: now, updatedAt: now },
      }),
      db.$executeRawUnsafe(auditCall.sql, ...auditCall.params),
    ]);

    assertMatchesAmbientTenant(tenant, OPERATION);
    const tenantDb = getTenantDb(OPERATION);
    await tenantDb.teamMember.deleteMany({ where: { staffUserId } });
    await tenantDb.userRoleAssignment.deleteMany({ where: { staffUserId } });
  }
}
