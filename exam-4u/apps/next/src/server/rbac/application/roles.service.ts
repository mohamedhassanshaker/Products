import type { PermissionEntity, RoleEntity } from '@/server/infrastructure/database';
import { PermissionNotFoundError, RoleInUseError, RoleNameExistsError, RoleNotFoundError, SystemRoleProtectedError } from '../domain/errors';
import type { CreateRoleInput, RoleSummary, UpdateRoleInput } from '../domain/rbac.types';
import type { PermissionRepository } from '../infrastructure/permission.repository';
import type { RoleRepository } from '../infrastructure/role.repository';
import type { UserRoleRepository } from '../infrastructure/user-role.repository';

function toSummary(role: RoleEntity): RoleSummary {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: (role.permissions ?? []).map((p) => ({ id: p.id, name: p.name, description: p.description, group: p.group })),
  };
}

/**
 * Full role CRUD + permission-grant management — ported verbatim (logic unchanged) from
 * `legacy/api/src/modules/rbac/application/roles.service.ts`'s `RolesService`.
 *
 * **System-role protection, precisely**: only the two provisioning-seeded rows
 * (`RoleEntity.isSystem === true`) are protected, and *only* against (a) rename via {@link update} and
 * (b) {@link delete}. Description edits and {@link replacePermissions} are always allowed regardless
 * of `isSystem` — a Tenant Admin may broaden/narrow `Member`'s default grants without being able to
 * rename or delete either seeded role.
 */
export class RolesService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly permissions: PermissionRepository,
    private readonly userRoles: UserRoleRepository,
  ) {}

  async list(): Promise<RoleSummary[]> {
    const rows = await this.roles.findAll();
    return rows.map(toSummary);
  }

  /** @throws {RoleNotFoundError} */
  async get(id: number): Promise<RoleSummary> {
    return toSummary(await this.requireRole(id));
  }

  /**
   * @throws {RoleNameExistsError} if `input.name` (trimmed) is already taken.
   * @throws {PermissionNotFoundError} if any `input.permissionIds` entry doesn't resolve.
   */
  async create(input: CreateRoleInput): Promise<RoleSummary> {
    const name = input.name.trim();
    if (await this.roles.existsByName(name)) {
      throw new RoleNameExistsError();
    }

    const resolvedPermissions = await this.resolvePermissions(input.permissionIds ?? []);
    const role = this.roles.create({ name, description: input.description ?? null, isSystem: false });
    role.permissions = resolvedPermissions;
    return toSummary(await this.roles.save(role));
  }

  /**
   * A no-op rename (same name, just re-trimmed) deliberately **skips** the uniqueness re-check —
   * ported verbatim from legacy (avoids a pointless `existsByName` self-collision).
   *
   * @throws {RoleNotFoundError}
   * @throws {SystemRoleProtectedError} renaming a system role.
   * @throws {RoleNameExistsError} the new name collides with a *different* role.
   */
  async update(id: number, input: UpdateRoleInput): Promise<RoleSummary> {
    const role = await this.requireRole(id);

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed !== role.name) {
        if (role.isSystem) throw new SystemRoleProtectedError();
        if (await this.roles.existsByName(trimmed)) throw new RoleNameExistsError();
        role.name = trimmed;
      }
    }
    if (input.description !== undefined) {
      role.description = input.description;
    }

    return toSummary(await this.roles.save(role));
  }

  /**
   * @throws {RoleNotFoundError}
   * @throws {SystemRoleProtectedError} — checked **before** the in-use check, so even an unreferenced
   *   system role can never be deleted.
   * @throws {RoleInUseError} the role is still assigned to at least one user.
   */
  async delete(id: number): Promise<void> {
    const role = await this.requireRole(id);
    if (role.isSystem) throw new SystemRoleProtectedError();
    if (await this.userRoles.isRoleReferenced(id)) throw new RoleInUseError();
    await this.roles.delete(id);
  }

  /** Atomic full replace of a role's permission grants — allowed on system roles too (only identity
   * is protected, not grants).
   *
   * @throws {RoleNotFoundError}
   * @throws {PermissionNotFoundError} any id doesn't resolve — the *whole* replace is rejected, never
   *   partially applied.
   */
  async replacePermissions(id: number, permissionIds: number[]): Promise<RoleSummary> {
    const role = await this.requireRole(id);
    role.permissions = await this.resolvePermissions(permissionIds);
    return toSummary(await this.roles.save(role));
  }

  private async requireRole(id: number): Promise<RoleEntity> {
    const role = await this.roles.findById(id);
    if (!role) throw new RoleNotFoundError();
    return role;
  }

  private async resolvePermissions(permissionIds: number[]): Promise<PermissionEntity[]> {
    if (permissionIds.length === 0) return [];
    const found = await this.permissions.findByIds(permissionIds);
    if (found.length !== new Set(permissionIds).size) {
      throw new PermissionNotFoundError();
    }
    return found;
  }
}
