import { PermissionInUseError, PermissionNotFoundError } from '../domain/errors';
import type { PermissionSummary } from '../domain/rbac.types';
import type { PermissionRepository } from '../infrastructure/permission.repository';

/**
 * Read/delete for the tenant-schema permission catalog — ported verbatim (logic unchanged) from
 * `legacy/api/src/modules/rbac/application/permissions-crud.service.ts`'s `PermissionsCrudService`.
 * No create method — the permission catalog is seeded once at provisioning time (`SeedRbacStep`) and
 * is not tenant-editable. `delete` has no Route Handler wired to it this dispatch either (matching
 * legacy's own "not yet wired to a controller" precedent — it exists to prove/exercise
 * `PERMISSION_IN_USE`, exercised directly by this module's own tests).
 */
export class PermissionsCrudService {
  constructor(private readonly permissions: PermissionRepository) {}

  async list(): Promise<PermissionSummary[]> {
    const rows = await this.permissions.findAll();
    return rows.map((p) => ({ id: p.id, name: p.name, description: p.description, group: p.group }));
  }

  /**
   * @throws {PermissionNotFoundError}
   * @throws {PermissionInUseError} still granted to at least one role.
   */
  async delete(id: number): Promise<void> {
    const permission = await this.permissions.findById(id);
    if (!permission) throw new PermissionNotFoundError();
    if (await this.permissions.isReferencedByAnyRole(id)) throw new PermissionInUseError();
    await this.permissions.delete(id);
  }
}
