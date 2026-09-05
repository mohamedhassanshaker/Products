import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { PackageEntity } from '@/server/infrastructure/database';

/**
 * Data access over `platform.package` — Phase 1a built the read path (`findByKey`/`findById`/
 * `findAll`); this dispatch (migration plan Phase 2 sub-slice "2b", FR-PKG-7) adds the write path
 * (`create`/`save`) plus `findAllActive`/`existsByKey` the Platform Admin catalog CRUD screens need —
 * ported from `legacy/api/src/platform/packages/infrastructure/repositories/package.repository.ts`.
 */
export class PackageRepository {
  private readonly repo: Repository<PackageEntity>;

  constructor(dataSource: DataSource) {
    // String-name lookup, not the class reference (fixed Phase 1 sub-slice 1b — see
    // `server/tenancy/raw-tenant-lookup.ts`'s doc comment for the cross-webpack-bundle
    // entity-class-identity mismatch this avoids).
    this.repo = dataSource.getRepository<PackageEntity>('package');
  }

  /** Looks up a package by its immutable `key` (e.g. the seeded `'starter'`/`'pro'`/`'enterprise'`).
   * `null` if no such package exists — every caller treats this as fail-closed. */
  async findByKey(key: string): Promise<PackageEntity | null> {
    return this.repo.findOne({ where: { key } });
  }

  /** Looks up a package by its primary key id (used to resolve a `tenant_subscription.package_id`). */
  async findById(id: string): Promise<PackageEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Every catalog package, ordered by `sortOrder` — the Packages list screen and (a later
   * sub-dispatch) the tenant-subscription reassignment dropdown's source data. */
  async findAll(): Promise<PackageEntity[]> {
    return this.repo.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  /** Only the currently-active packages — a future reassignment dropdown deliberately excludes
   * inactive packages as a *new*-assignment target (not consumed by anything in this dispatch, kept
   * for that later sub-dispatch to reuse rather than re-derive). */
  async findAllActive(): Promise<PackageEntity[]> {
    return this.repo.find({ where: { isActive: true }, order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  /** True if any *other* package (excluding `excludeId`, for an update's own row) already has this
   * `key` — the `PACKAGE_KEY_EXISTS` check (`uq_package_key`). */
  async existsByKey(key: string, excludeId?: string): Promise<boolean> {
    const qb = this.repo.createQueryBuilder('p').where('p.key = :key', { key });
    if (excludeId) qb.andWhere('p.id != :excludeId', { excludeId });
    return (await qb.getCount()) > 0;
  }

  /** Creates a new catalog package row. Caller (`PackagesService`) has already checked
   * `PACKAGE_KEY_EXISTS`. `stripePriceId` stays `null` — no Stripe integration exists in this app yet
   * (a later sub-dispatch's scope). */
  async create(input: {
    key: string;
    name: string;
    description: string | null;
    priceCents: number;
    currency: string;
    isActive: boolean;
    sortOrder: number;
  }): Promise<PackageEntity> {
    const entity = this.repo.create({ id: randomUUID(), stripePriceId: null, ...input });
    return this.repo.save(entity);
  }

  /** Persists an already-mutated `PackageEntity` (the caller applies field changes, this just
   * saves). */
  async save(entity: PackageEntity): Promise<PackageEntity> {
    return this.repo.save(entity);
  }
}
