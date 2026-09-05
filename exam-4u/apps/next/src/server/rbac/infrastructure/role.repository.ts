import type { DataSource, Repository } from 'typeorm';
import { RoleEntity } from '@/server/infrastructure/database';

/**
 * The sole place that ever queries the tenant-schema `role` table — ported verbatim (logic
 * unchanged) from `legacy/api/src/modules/rbac/infrastructure/repositories/role.repository.ts`.
 * `findAll`/`findById` eagerly load the `permissions` relation (declared `eager: false` on the entity
 * itself) since every caller of those two methods needs grants; other lookups (`findByName`,
 * `existsByName`) don't.
 */
export class RoleRepository {
  private readonly repo: Repository<RoleEntity>;

  constructor(dataSource: DataSource) {
    // String-name lookup, not the class reference — see `server/tenancy/raw-tenant-lookup.ts`'s doc
    // comment (cross-webpack-bundle entity-class-identity mismatch under production minification).
    this.repo = dataSource.getRepository<RoleEntity>('role');
  }

  async findAll(): Promise<RoleEntity[]> {
    return this.repo.find({ relations: ['permissions'], order: { name: 'ASC' } });
  }

  async findById(id: number): Promise<RoleEntity | null> {
    return this.repo.findOne({ where: { id }, relations: ['permissions'] });
  }

  async findByName(name: string): Promise<RoleEntity | null> {
    return this.repo.findOne({ where: { name } });
  }

  async existsByName(name: string): Promise<boolean> {
    const count = await this.repo.count({ where: { name } });
    return count > 0;
  }

  /** Builds (does not persist) a new entity — callers attach resolved `permissions` before saving. */
  create(data: Partial<RoleEntity>): RoleEntity {
    return this.repo.create(data);
  }

  async save(role: RoleEntity): Promise<RoleEntity> {
    return this.repo.save(role);
  }

  /** Callers must have already verified the role isn't system-protected/in-use — this is a thin
   * delete, not a business-rule check. `role_permission` rows for this role are removed automatically
   * by the DB's `ON DELETE CASCADE` FK — no explicit cleanup needed here. */
  async delete(id: number): Promise<void> {
    await this.repo.delete({ id });
  }
}
