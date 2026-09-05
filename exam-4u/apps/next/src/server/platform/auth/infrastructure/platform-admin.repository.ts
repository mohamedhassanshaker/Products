import type { DataSource, Repository } from 'typeorm';
import { PlatformAdminEntity } from '@/server/infrastructure/database';

/**
 * The sole place that ever queries `platform.platform_admin` — ported verbatim (logic unchanged)
 * from `legacy/api/src/platform/auth/infrastructure/repositories/platform-admin.repository.ts`.
 * Connects exclusively through the single, non-tenant-scoped platform `DataSource` — a
 * `platform_admin` row is never resolvable through any tenant `DataSource`.
 */
export class PlatformAdminRepository {
  private readonly repo: Repository<PlatformAdminEntity>;

  constructor(dataSource: DataSource) {
    // String-name lookup, not the class reference — see `server/tenancy/raw-tenant-lookup.ts`'s doc
    // comment (cross-webpack-bundle entity-class-identity mismatch under production minification).
    this.repo = dataSource.getRepository<PlatformAdminEntity>('platform_admin');
  }

  /** Normalizes to lowercase/trim — redundant-safe alongside the service's own normalization. */
  async findByEmail(email: string): Promise<PlatformAdminEntity | null> {
    return this.repo.findOne({ where: { email: email.trim().toLowerCase() } });
  }

  async findById(id: string): Promise<PlatformAdminEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  async insert(data: Partial<PlatformAdminEntity>): Promise<PlatformAdminEntity> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  async updateLastLogin(id: string, when: Date): Promise<void> {
    await this.repo.update({ id }, { lastLoginAt: when });
  }

  /** Used by {@link import('../application/platform-admin-bootstrap.service').PlatformAdminBootstrapService}
   * to decide whether the table is completely empty. */
  async count(): Promise<number> {
    return this.repo.count();
  }
}
