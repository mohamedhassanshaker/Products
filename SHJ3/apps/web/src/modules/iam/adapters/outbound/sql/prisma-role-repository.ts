/**
 * The real `RoleRepository` — B9 tab 3, per-tenant (`prisma/tenant/schema.prisma`).
 *
 * `permissionMatrix()` here queries the same `Role`/`RolePermission` tables
 * `PrismaUserRepository.permissionMatrix()` reads for authorization's own purposes — a
 * small, deliberate duplication of a five-line query rather than a forced shared
 * abstraction between two conceptually different ports (one for auth resolution, one for
 * B9 tab 3's own screen), matching this codebase's own "don't force an abstraction onto
 * two unrelated callers just to save a few lines" instinct.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isPermission,
  PERMISSION_CATALOG,
  ROLE_KEYS,
  type Permission,
} from "../../../domain/permissions.js";
import type {
  NewCustomRole,
  PermissionCatalogEntry,
  Role,
  RolePermissionChange,
  RoleRepository,
  UpdatePermissionsResult,
} from "../../../ports/role-repository.js";

const OPERATION = "iam role repository";

interface RoleRow {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly isSystem: boolean;
  readonly ordinal: number;
  readonly description: string | null;
}

function toDomainRole(row: RoleRow): Role {
  return {
    id: row.id,
    key: row.key,
    displayName: row.displayName,
    isSystem: row.isSystem,
    ordinal: row.ordinal,
    description: row.description,
  };
}

const ROLE_SELECT = {
  id: true,
  key: true,
  displayName: true,
  isSystem: true,
  ordinal: true,
  description: true,
} as const;

/**
 * Slugify `displayName` into a `Role.key`, disambiguated against every existing live key
 * — never supplied by the caller (the port's own doc comment). Non-alphanumeric runs
 * collapse to one underscore, matching `ROLE_KEYS`'s own snake_case convention for the 7
 * seeded roles, so a custom role's key reads consistently alongside them.
 */
function uniqueRoleKey(displayName: string, existingKeys: ReadonlySet<string>): string {
  const base =
    displayName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "role";

  if (!existingKeys.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!existingKeys.has(candidate)) return candidate;
  }
}

/**
 * The trigger's own real message text (`prisma/sql/001_constraints.sql`'s
 * `TR_RolePermissions_protectSuperAdmin`), transcribed exactly — confirmed live against
 * the real, wrapped Prisma/SQL Server error before this constant was written, not
 * assumed from reading the trigger's source alone. This is what a caller gets in the
 * structured result's `message` field; the substring match below only needs the stable
 * tail of it, in case a driver upgrade ever changes how much surrounding noise Prisma
 * wraps the SQL Server text in.
 */
const PROTECTED_SUPER_ADMIN_MESSAGE =
  "The super_admin grant for users:manage cannot be revoked (B9 tab 3).";

/**
 * `TR_RolePermissions_protectSuperAdmin` (§4.2, `prisma/sql/001_constraints.sql`) fires on
 * exactly one shape — a `DELETE` of the `super_admin` role's `users:manage` grant — so the
 * offending change in a batch can be identified by matching that shape directly, rather
 * than parsing anything further out of the wrapped SQL Server error text. Matches
 * `prisma-theme-repository.ts`'s `blockingTriggerReason()` precedent: detect a specific,
 * known trigger message substring, translate it into a structured result, and rethrow
 * anything else unrecognised.
 */
function findProtectedChange(
  error: unknown,
  changes: readonly RolePermissionChange[],
): RolePermissionChange | null {
  if (!(error instanceof Error) || !error.message.includes("cannot be revoked (B9 tab 3)")) {
    return null;
  }
  return (
    changes.find(
      (change) =>
        !change.granted &&
        change.roleKey === ROLE_KEYS.SuperAdmin &&
        change.permission === "users:manage",
    ) ?? null
  );
}

export class PrismaRoleRepository implements RoleRepository {
  async list(): Promise<readonly Role[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.role.findMany({
      where: { deletedAt: null },
      select: ROLE_SELECT,
      orderBy: { ordinal: "asc" },
    });
    return rows.map(toDomainRole);
  }

  async listPermissionCatalog(): Promise<readonly PermissionCatalogEntry[]> {
    // Zero I/O — see PERMISSION_CATALOG's own doc comment for why this is not a
    // platform.Permissions query.
    return PERMISSION_CATALOG;
  }

  async createCustomRole(role: NewCustomRole): Promise<Role> {
    const db = getTenantDb(OPERATION);
    const existing = await db.role.findMany({
      where: { deletedAt: null },
      select: { key: true, ordinal: true },
    });
    const key = uniqueRoleKey(role.displayName, new Set(existing.map((r) => r.key)));
    const nextOrdinal = existing.reduce((max, r) => Math.max(max, r.ordinal), -1) + 1;

    const now = new Date();
    const row = await db.role.create({
      data: {
        id: newUlid(now),
        key,
        displayName: role.displayName,
        isSystem: false,
        ordinal: nextOrdinal,
        description: role.description ?? null,
        createdAt: now,
        updatedAt: now,
      },
      select: ROLE_SELECT,
    });
    return toDomainRole(row);
  }

  async permissionMatrix(): Promise<Readonly<Record<string, readonly Permission[]>>> {
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

  /**
   * All-or-nothing (the port's own doc comment): every change is one Prisma operation in a
   * single `$transaction([...])` array, so a trigger rejection on any one of them rolls
   * back the whole batch rather than leaving a bulk row/column toggle half-applied.
   */
  async updatePermissions(
    changes: readonly RolePermissionChange[],
    actorId: string,
  ): Promise<UpdatePermissionsResult> {
    if (changes.length === 0) return { ok: true };

    const db = getTenantDb(OPERATION);
    const roleKeys = [...new Set(changes.map((change) => change.roleKey))];
    const roles = await db.role.findMany({
      where: { key: { in: roleKeys }, deletedAt: null },
      select: { id: true, key: true },
    });
    const roleIdByKey = new Map(roles.map((role) => [role.key, role.id]));

    const missing = roleKeys.filter((key) => !roleIdByKey.has(key));
    if (missing.length > 0) {
      throw new Error(
        `Cannot update permissions for unknown or deleted role key(s): ${missing.join(", ")}.`,
      );
    }

    const now = new Date();
    const operations = changes.map((change) => {
      const roleId = roleIdByKey.get(change.roleKey)!;
      if (change.granted) {
        return db.rolePermission.upsert({
          where: { roleId_permissionKey: { roleId, permissionKey: change.permission } },
          create: {
            id: newUlid(now),
            roleId,
            permissionKey: change.permission,
            grantedByStaffUserId: actorId,
            grantedAt: now,
            createdAt: now,
            updatedAt: now,
          },
          // Already granted — a no-op for the "granted" fact itself (the port's own
          // contract: "a change whose granted already matches the current state is a
          // no-op"), touching only updatedAt rather than an empty update payload.
          update: { updatedAt: now },
        });
      }
      // A missing row is already "not granted" — deleteMany of zero rows is the no-op
      // this same contract requires for the opposite direction.
      return db.rolePermission.deleteMany({ where: { roleId, permissionKey: change.permission } });
    });

    try {
      await db.$transaction(operations);
      return { ok: true };
    } catch (error) {
      const protectedChange = findProtectedChange(error, changes);
      if (protectedChange) {
        return {
          ok: false,
          reason: "protected",
          roleKey: protectedChange.roleKey,
          permission: protectedChange.permission,
          // The trigger's own real message text, not the raw wrapped Prisma error —
          // confirmed live (not assumed) that the wrapped error's `.message` also
          // includes Prisma's own file/line noise around the SQL Server text, which is
          // fine for the substring match `findProtectedChange` does above but not what a
          // caller should ever render or log as a clean, user-facing string.
          message: PROTECTED_SUPER_ADMIN_MESSAGE,
        };
      }
      throw error;
    }
  }
}
