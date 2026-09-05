import { In, type DataSource, type Repository } from 'typeorm';
import { PermissionEntity } from '@/server/infrastructure/database';

/**
 * The sole place that ever queries the tenant-schema `permission` table — ported verbatim (logic
 * unchanged) from `legacy/api/src/modules/rbac/infrastructure/repositories/permission.repository.ts`.
 */
export class PermissionRepository {
  private readonly repo: Repository<PermissionEntity>;

  constructor(private readonly dataSource: DataSource) {
    // String-name lookup, not the class reference — see `server/tenancy/raw-tenant-lookup.ts`'s doc
    // comment (cross-webpack-bundle entity-class-identity mismatch under production minification).
    this.repo = dataSource.getRepository<PermissionEntity>('permission');
  }

  async findAll(): Promise<PermissionEntity[]> {
    return this.repo.find({ order: { group: 'ASC', name: 'ASC' } });
  }

  async findById(id: number): Promise<PermissionEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Resolves every id in `ids` — callers compare the result length against `new Set(ids).size` to
   * detect any id that didn't resolve (an unknown permission id). */
  async findByIds(ids: number[]): Promise<PermissionEntity[]> {
    if (ids.length === 0) return [];
    return this.repo.find({ where: { id: In(ids) } });
  }

  /** Defense in depth on top of the DB's own `role_permission.permission_id` `ON DELETE RESTRICT` FK
   * — gives `PermissionsCrudService.delete` a clean `DomainError` instead of letting a raw
   * constraint-violation driver error leak through. */
  async isReferencedByAnyRole(id: number): Promise<boolean> {
    const rows: { count: number }[] = await this.dataSource.query(
      'SELECT COUNT(*) AS count FROM role_permission WHERE permission_id = ?',
      [id],
    );
    return Number(rows[0]?.count ?? 0) > 0;
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete({ id });
  }
}
