/**
 * The real `DemoDataSeeder` — writes `platform.Permissions`, per-tenant `Roles`/
 * `RolePermissions`/`Teams`/`TeamMembers`/`UserRoleAssignments`, and `platform.StaffUsers`/
 * `TenantMemberships` directly, bypassing the ordinary B9 CRUD ports for exactly the
 * reasons `demo-data-seeder.ts`'s own doc comment gives (system roles, the code-defined
 * permission catalog, a staff user seeded directly into an already-accepted status).
 *
 * Every `*ByStaffUserId`/`*ByStaffUserId` attribution column this file writes
 * (`grantedByStaffUserId`, `addedByStaffUserId`, `assignedByStaffUserId`) uses
 * `SYSTEM_SEED_ACTOR_ID` rather than a real `StaffUsers.id` — honest, since none of these
 * grants were actually made by a human admin, and safe, since none of these columns are
 * FK-enforced across the schema boundary (`TeamMember`'s own header comment states this
 * explicitly, and the same reasoning applies to every sibling column here).
 */

import {
  getPlatformDb,
  getTenantDb,
} from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { currentTenant } from "../../../../platform/tenancy/tenant-context.js";
import type { TenantSlug } from "../../../../platform/tenancy/tenant-slug.js";
import {
  PERMISSION_CATALOG,
  ROLE_KEYS,
  SEEDED_ROLES,
  SEEDED_ROLE_DISPLAY_NAMES,
  SEEDED_ROLE_PERMISSIONS,
} from "../../../domain/permissions.js";
import type { DemoDataSeeder } from "../../../ports/demo-data-seeder.js";
import type { StaffUserStatus } from "../../../ports/user-repository.js";
import type { TeamScope } from "../../../ports/team-repository.js";

const OPERATION = "iam demo data seeder";

/**
 * A synthetic, never-persisted-as-a-real-user CHAR(26) id — computed, not hand-typed, so
 * its length is correct by construction rather than by manual counting.
 */
const SYSTEM_SEED_ACTOR_ID = `SEED${"0".repeat(21)}1`;

/** Every `platform.Permissions.moduleKey` this wave seeds — B9 is the only module writing this table so far. */
const MODULE_KEY = "iam";

function assertMatchesAmbientTenant(tenant: TenantSlug): void {
  const ambient = currentTenant(OPERATION);
  if (ambient !== tenant) {
    throw new Error(
      `${OPERATION}: called for tenant "${tenant}" but the ambient bound tenant is "${ambient}". ` +
        "getTenantDb() resolves the schema from the ambient context, not this argument.",
    );
  }
}

export class PrismaDemoDataSeeder implements DemoDataSeeder {
  async seedPermissionCatalog(): Promise<void> {
    const db = getPlatformDb(OPERATION);
    const now = new Date();
    for (const entry of PERMISSION_CATALOG) {
      const existing = await db.permission.findUnique({ where: { key: entry.key } });
      if (existing) continue;
      await db.permission.create({
        data: {
          key: entry.key,
          displayName: entry.displayName,
          moduleKey: MODULE_KEY,
          ordinal: entry.ordinal,
          description: entry.displayName,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
  }

  async seedSeededRolesAndGrants(tenant: TenantSlug): Promise<void> {
    assertMatchesAmbientTenant(tenant);
    const db = getTenantDb(OPERATION);
    const now = new Date();

    const roleIdByKey = new Map<string, string>();
    for (const [index, seededRole] of SEEDED_ROLES.entries()) {
      const key = ROLE_KEYS[seededRole];
      const existingRole = await db.role.findFirst({ where: { key, deletedAt: null } });
      const role =
        existingRole ??
        (await db.role.create({
          data: {
            id: newUlid(new Date(now.getTime() + index)),
            key,
            displayName: SEEDED_ROLE_DISPLAY_NAMES[seededRole],
            isSystem: true,
            ordinal: index,
            description: null,
            createdAt: now,
            updatedAt: now,
          },
        }));
      roleIdByKey.set(key, role.id);
    }

    for (const seededRole of SEEDED_ROLES) {
      const roleId = roleIdByKey.get(ROLE_KEYS[seededRole]);
      if (roleId === undefined) continue; // unreachable — every SEEDED_ROLES entry was just inserted above.
      for (const permission of SEEDED_ROLE_PERMISSIONS[seededRole]) {
        const existingGrant = await db.rolePermission.findUnique({
          where: { roleId_permissionKey: { roleId, permissionKey: permission } },
        });
        if (existingGrant) continue;
        await db.rolePermission.create({
          data: {
            id: newUlid(now),
            roleId,
            permissionKey: permission,
            grantedByStaffUserId: SYSTEM_SEED_ACTOR_ID,
            grantedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }
  }

  async ensureStaffUser(input: {
    readonly email: string;
    readonly displayName: string;
    readonly status: StaffUserStatus;
    readonly homeTenant: TenantSlug;
  }): Promise<string> {
    const db = getPlatformDb(OPERATION);
    const email = input.email.trim().toLowerCase();
    const now = new Date();

    const existing = await db.staffUser.findFirst({ where: { email, deletedAt: null } });
    if (existing) {
      if (existing.status !== input.status) {
        await db.staffUser.update({
          where: { id: existing.id },
          data: { status: input.status, updatedAt: now },
        });
      }
      return existing.id;
    }

    const tenantRow = await db.tenant.findUniqueOrThrow({
      where: { slug: input.homeTenant },
      select: { id: true },
    });
    const id = newUlid(now);
    // `CK_StaffUsers_invitedHasNoLogin`: an Invited seed row keeps acceptedAt/lastLoginAt
    // null; Active/Suspended seed rows are seeded as already-accepted (a real invitation
    // was never sent, but the fixture's whole point is to represent an established
    // account in that status, not a mid-invitation one).
    const isInvited = input.status === "Invited";

    await db.$transaction([
      db.staffUser.create({
        data: {
          id,
          email,
          displayName: input.displayName,
          status: input.status,
          homeTenantId: tenantRow.id,
          invitedAt: now,
          acceptedAt: isInvited ? null : now,
          sessionEpoch: 0,
          createdAt: now,
          updatedAt: now,
        },
      }),
      db.tenantMembership.create({
        data: {
          id: newUlid(new Date(now.getTime() + 1)),
          staffUserId: id,
          tenantId: tenantRow.id,
          isPrimary: true,
          // Self-referencing, not SYSTEM_SEED_ACTOR_ID: found live, not assumed —
          // `TenantMemberships_grantedByStaffUserId_fkey` is a REAL, same-platform-schema
          // Prisma relation (`TenantMembership.grantedBy`, prisma/platform/schema.prisma),
          // unlike `TeamMember.addedByStaffUserId`/`RolePermission.grantedByStaffUserId`/
          // `UserRoleAssignment.assignedByStaffUserId` (all tenant-schema, genuinely NOT
          // FK-enforced per ADR-0011's cross-client limitation — confirmed by grep before
          // this fix, not re-guessed). `SYSTEM_SEED_ACTOR_ID` satisfied every one of those
          // but violated this one on the very first live run. The newly created user's own
          // id is a real, valid row by the time this statement executes (same transaction,
          // staffUser.create above runs first) — "this account's own first membership was
          // self-granted at bootstrap" is an honest fact, not a workaround.
          grantedByStaffUserId: id,
          grantedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ]);

    return id;
  }

  async ensureTeam(
    tenant: TenantSlug,
    input: { readonly name: string; readonly scope: TeamScope },
  ): Promise<string> {
    assertMatchesAmbientTenant(tenant);
    const db = getTenantDb(OPERATION);
    const existing = await db.team.findFirst({ where: { name: input.name, deletedAt: null } });
    if (existing) return existing.id;

    const now = new Date();
    const created = await db.team.create({
      data: {
        id: newUlid(now),
        name: input.name,
        scope: input.scope,
        description: null,
        // Not `isSystem: true` — nothing in this schema blocks deleting/renaming a seeded
        // team the way `TR_Roles_blockSystemDelete` protects a seeded role, so marking it
        // "system" would claim a protection that does not exist. These are ordinary teams
        // that happen to be pre-populated, fully editable by a real Entity Admin.
        isSystem: false,
        createdAt: now,
        updatedAt: now,
      },
    });
    return created.id;
  }

  async ensurePrimaryTeamMembership(
    tenant: TenantSlug,
    staffUserId: string,
    teamId: string,
  ): Promise<void> {
    assertMatchesAmbientTenant(tenant);
    const db = getTenantDb(OPERATION);
    const existing = await db.teamMember.findFirst({ where: { staffUserId, isPrimary: true } });
    if (existing) {
      if (existing.teamId === teamId) return;
      await db.teamMember.delete({ where: { id: existing.id } });
    }

    const now = new Date();
    await db.teamMember.create({
      data: {
        id: newUlid(now),
        teamId,
        staffUserId,
        isPrimary: true,
        addedByStaffUserId: SYSTEM_SEED_ACTOR_ID,
        addedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async ensureRoleAssignment(
    tenant: TenantSlug,
    staffUserId: string,
    roleKey: string,
  ): Promise<void> {
    assertMatchesAmbientTenant(tenant);
    const db = getTenantDb(OPERATION);
    const role = await db.role.findFirst({ where: { key: roleKey, deletedAt: null } });
    if (!role) {
      throw new Error(
        `Cannot assign unknown or deleted role key "${roleKey}" in tenant "${tenant}" — ` +
          "seedSeededRolesAndGrants() must run before ensureRoleAssignment() for this tenant.",
      );
    }

    const existing = await db.userRoleAssignment.findUnique({
      where: { staffUserId_roleId: { staffUserId, roleId: role.id } },
    });
    if (existing) return;

    const now = new Date();
    await db.userRoleAssignment.create({
      data: {
        id: newUlid(now),
        staffUserId,
        roleId: role.id,
        scopeTeamId: null,
        assignedByStaffUserId: SYSTEM_SEED_ACTOR_ID,
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
}
