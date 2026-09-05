import { randomUUID } from 'node:crypto';
import { In, type DataSource, type Repository } from 'typeorm';
import { FeatureEntity, PackageFeatureEntity } from '@/server/infrastructure/database';

/**
 * Data access over `platform.feature` — Phase 1a built the read path (`findByKey`/`findAll`); this
 * dispatch (migration plan Phase 2 sub-slice "2b", FR-PKG-7) adds the write path
 * (`create`/`save`/`delete`) plus `findById`/`findByIds`/`existsByKey`/`countPackageReferences(ByFeatureIds)`
 * — ported from `legacy/api/src/platform/features/infrastructure/repositories/feature.repository.ts`.
 *
 * **Deliberately queries `package_feature` directly here (via this repository's own `DataSource`)
 * rather than depending on `PackageFeatureRepository`**: both entities live in the shared,
 * module-agnostic `infrastructure/database/platform/entities/**` per this codebase's established
 * convention (an entity import carries no module-ownership implication) — reading it directly avoids
 * a `platform/billing`-internal-to-itself dependency for no benefit, matching legacy's own identical
 * doc-comment reasoning at this exact call site.
 */
export class FeatureRepository {
  private readonly repo: Repository<FeatureEntity>;
  private readonly packageFeatureRepo: Repository<PackageFeatureEntity>;

  constructor(dataSource: DataSource) {
    // String-name lookup, not the class reference (fixed Phase 1 sub-slice 1b — see
    // `server/tenancy/raw-tenant-lookup.ts`'s doc comment for the cross-webpack-bundle
    // entity-class-identity mismatch this avoids).
    this.repo = dataSource.getRepository<FeatureEntity>('feature');
    this.packageFeatureRepo = dataSource.getRepository<PackageFeatureEntity>('package_feature');
  }

  /** Looks up a feature by its immutable `key` (e.g. `'exams.create'`). */
  async findByKey(key: string): Promise<FeatureEntity | null> {
    return this.repo.findOne({ where: { key } });
  }

  /** Every catalog feature — the exact 9-row seeded set this dispatch's migration inserts, plus any
   * Platform-Admin-created ones. */
  async findAll(): Promise<FeatureEntity[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  /** A single feature by primary key id, or `null` if none exists — used by the edit screen's detail
   * fetch and by `FeaturesService.update`/`delete`'s existence checks. */
  async findById(id: string): Promise<FeatureEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Every feature matching the given ids — used by `PackagesService.replaceFeatures` (a plain TS
   * cross-module import, no Nest-equivalent DI cycle risk) to validate every `featureId` in an atomic
   * `PUT .../features` payload actually exists before writing anything (`FEATURE_NOT_FOUND`). Returns
   * fewer rows than `ids.length` if some don't exist. */
  async findByIds(ids: string[]): Promise<FeatureEntity[]> {
    if (ids.length === 0) return [];
    return this.repo.find({ where: { id: In(ids) } });
  }

  /** True if any *other* feature (excluding `excludeId`, for an update's own row) already has this
   * `key` — the `FEATURE_KEY_EXISTS` check (`uq_feature_key`). */
  async existsByKey(key: string, excludeId?: string): Promise<boolean> {
    const qb = this.repo.createQueryBuilder('f').where('f.key = :key', { key });
    if (excludeId) qb.andWhere('f.id != :excludeId', { excludeId });
    return (await qb.getCount()) > 0;
  }

  /** How many `package_feature` rows reference this feature — `0` means the feature is safe to
   * key-edit/delete; `>0` drives both `FEATURE_KEY_IMMUTABLE` (on a key-change attempt) and
   * `FEATURE_IN_USE` (on a delete attempt), and is exposed to the client as the `isReferenced` boolean
   * flag the packages/features console needs for its preemptive Key-lock UX. */
  async countPackageReferences(featureId: string): Promise<number> {
    return this.packageFeatureRepo.count({ where: { featureId } });
  }

  /** Bulk variant of {@link countPackageReferences}, one query instead of N — used by the Features
   * list endpoint so `isReferenced` doesn't cost one query per row. */
  async countPackageReferencesByFeatureIds(featureIds: string[]): Promise<Map<string, number>> {
    if (featureIds.length === 0) return new Map();
    const rows = await this.packageFeatureRepo
      .createQueryBuilder('pf')
      .select('pf.feature_id', 'featureId')
      .addSelect('COUNT(*)', 'count')
      .where('pf.feature_id IN (:...featureIds)', { featureIds })
      .groupBy('pf.feature_id')
      .getRawMany<{ featureId: string; count: string }>();
    return new Map(rows.map((r) => [r.featureId, Number(r.count)]));
  }

  /** Creates a new catalog feature row. Caller (`FeaturesService`) has already checked
   * `FEATURE_KEY_EXISTS`. */
  async create(input: {
    key: string;
    name: string;
    description: string | null;
    unit: string;
    resetPeriod: 'NONE' | 'DAILY' | 'MONTHLY';
  }): Promise<FeatureEntity> {
    const entity = this.repo.create({ id: randomUUID(), ...input });
    return this.repo.save(entity);
  }

  /** Persists an already-mutated `FeatureEntity` (the caller applies field changes, this just
   * saves). */
  async save(entity: FeatureEntity): Promise<FeatureEntity> {
    return this.repo.save(entity);
  }

  /** Hard-deletes a feature row. Caller (`FeaturesService`) has already checked `FEATURE_IN_USE`
   * (`fk_pf_feature ... ON DELETE RESTRICT` is a DB-level backstop, not the primary guard, since the
   * primary guard needs to produce the documented `ErrorCode` rather than a raw constraint-violation
   * error). */
  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}
