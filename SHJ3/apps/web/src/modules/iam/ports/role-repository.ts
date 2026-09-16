/**
 * Role and permission-matrix persistence — B9 tab 3.
 *
 * Sibling to `user-repository.ts` and `team-repository.ts`, same port/adapter split.
 * `Role`/`RolePermission` live in `prisma/tenant/schema.prisma` (per-tenant, which is what
 * makes B9 tab 3's own "+ Add custom role" work while `platform.Permissions` stays a
 * closed, code-defined catalogue — `docs/data-model.md` §4.2).
 *
 * `UserRepository.permissionMatrix(tenant)` (`user-repository.ts`) already reads this same
 * table for authorization's own purposes (`resolvePermissions`) — this port is the *write*
 * side plus the *catalogue* reads (`list()`, `listPermissionCatalog()`) B9 tab 3's screen
 * itself needs, which `UserRepository` has no reason to carry.
 */

import type { Permission } from "../domain/permissions.js";

export interface Role {
  readonly id: string;
  /** The persisted, snake_case key (`domain/permissions.ts`'s `ROLE_KEYS` for the 7 seeded roles; a slug derived from `displayName` for a custom one). */
  readonly key: string;
  readonly displayName: string;
  readonly isSystem: boolean;
  /** Fixes B9 tab 3's matrix column order (`UQ_Roles_ordinal`). */
  readonly ordinal: number;
  readonly description: string | null;
}

export interface NewCustomRole {
  readonly displayName: string;
  readonly description?: string;
  readonly createdByStaffUserId: string;
}

/** One entry of `platform.Permissions` — B9 tab 3's row headers, in `ordinal` order. */
export interface PermissionCatalogEntry {
  readonly key: Permission;
  readonly displayName: string;
  readonly ordinal: number;
}

export interface RolePermissionChange {
  readonly roleKey: string;
  readonly permission: Permission;
  readonly granted: boolean;
}

export type UpdatePermissionsResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /**
       * `TR_RolePermissions_protectSuperAdmin` refused a revoke. Named precisely, not
       * collapsed into a generic failure — B-2's brief: "wire it, don't just let the DB
       * trigger's error reach the user as a raw failure."
       */
      readonly reason: "protected";
      readonly roleKey: string;
      readonly permission: Permission;
      readonly message: string;
    };

export interface RoleRepository {
  /** Every live role, ordered by `ordinal` — B9 tab 3's matrix column order. */
  list(): Promise<readonly Role[]>;

  /** `platform.Permissions`, ordered by `ordinal` — B9 tab 3's matrix row order. */
  listPermissionCatalog(): Promise<readonly PermissionCatalogEntry[]>;

  /**
   * Appends a blank role with every permission off (B9 tab 3's "+ Add custom role").
   * `key` is derived from `displayName` (lowercase, non-alphanumeric runs collapsed to a
   * single underscore) and disambiguated against every existing live key in this tenant —
   * never supplied by the caller, so two custom roles can share a display name without a
   * key collision.
   */
  createCustomRole(role: NewCustomRole): Promise<Role>;

  /** The tenant's live 7×9-or-more matrix, keyed by `Role.key` — the same shape `UserRepository.permissionMatrix` returns, read from the same table. */
  permissionMatrix(): Promise<Readonly<Record<string, readonly Permission[]>>>;

  /**
   * Apply a batch of grant/revoke changes.
   *
   * All-or-nothing: if any change is rejected by `TR_RolePermissions_protectSuperAdmin`,
   * none of the batch's changes are applied — a bulk row/column toggle that partially
   * lands would leave the matrix in a state B9 tab 3 never actually asked for. A change
   * whose `granted` already matches the current state is a no-op, not an error.
   */
  updatePermissions(
    changes: readonly RolePermissionChange[],
    actorId: string,
  ): Promise<UpdatePermissionsResult>;
}
