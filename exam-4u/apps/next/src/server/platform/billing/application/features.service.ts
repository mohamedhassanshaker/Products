import type { FeatureEntity } from '@/server/infrastructure/database';
import { isValidCatalogKey } from '@/server/common/util/catalog-key.util';
import { ValidationFailedError } from '@/server/common/errors/domain-error';
import { FeatureInUseError, FeatureKeyExistsError, FeatureKeyImmutableError, FeatureNotFoundError } from '../domain/errors';
import type { FeatureRepository } from '../infrastructure/feature.repository';

/** The `Feature` catalog projection the Platform Admin console consumes — a plain `FeatureEntity`
 * field set plus the derived `isReferenced` flag so the edit screen can preemptively disable the Key
 * field rather than surprising the admin with a post-submit `409 FEATURE_KEY_IMMUTABLE` (ported
 * pattern from `legacy/api/src/platform/features/application/features.service.ts`). */
export interface FeatureSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  unit: string;
  resetPeriod: 'NONE' | 'DAILY' | 'MONTHLY';
  isReferenced: boolean;
  createdAt: Date;
}

/**
 * Platform Admin catalog CRUD for `platform.feature` (FR-PKG-7, migration plan Phase 2 sub-slice
 * "2b") — the write-side counterpart to Phase 1a's read-only `FeatureRepository`. Ported logic from
 * `legacy/api/src/platform/features/application/features.service.ts`, adapted to a plain class this
 * module's barrel constructs (no DI container).
 *
 * Every fail-closed invariant this class enforces mirrors an already-catalogued `ErrorCode`
 * (`FEATURE_KEY_EXISTS`/`FEATURE_KEY_IMMUTABLE`/`FEATURE_IN_USE`/`FEATURE_NOT_FOUND`) that
 * `@examland/contracts`' `error-codes.ts` already reserves for exactly this purpose (LLD §13.2's
 * pre-settled catalog — added ahead of this dispatch, per that file's own "seeded now, not grown
 * phase-by-phase" convention).
 */
export class FeaturesService {
  constructor(private readonly features: FeatureRepository) {}

  /** Every catalog feature, each annotated with whether it's currently referenced by any package —
   * computed via one grouped query, not N. */
  async list(): Promise<FeatureSummary[]> {
    const rows = await this.features.findAll();
    const counts = await this.features.countPackageReferencesByFeatureIds(rows.map((r) => r.id));
    return rows.map((row) => this.toSummary(row, (counts.get(row.id) ?? 0) > 0));
  }

  /** @throws {FeatureNotFoundError} if `id` doesn't resolve to any feature. */
  async get(id: string): Promise<FeatureSummary> {
    const row = await this.features.findById(id);
    if (!row) throw new FeatureNotFoundError();
    const referenced = (await this.features.countPackageReferences(id)) > 0;
    return this.toSummary(row, referenced);
  }

  /**
   * @throws {ValidationFailedError} if `input.key` doesn't match the catalog key shape (lowercase
   *   letters/digits/`._-` segments — see `catalog-key.util.ts`).
   * @throws {FeatureKeyExistsError} if `input.key` collides with an existing feature.
   */
  async create(input: {
    key: string;
    name: string;
    description?: string | null;
    unit: string;
    resetPeriod: 'NONE' | 'DAILY' | 'MONTHLY';
  }): Promise<FeatureSummary> {
    const key = input.key?.trim();
    if (!key || !isValidCatalogKey(key)) {
      throw new ValidationFailedError([
        { field: 'key', constraint: 'key must be lowercase letters, numbers, and separators (. _ -) only, e.g. "exams.create".' },
      ]);
    }
    if (await this.features.existsByKey(key)) {
      throw new FeatureKeyExistsError();
    }
    const row = await this.features.create({
      key,
      name: input.name,
      description: input.description ?? null,
      unit: input.unit,
      resetPeriod: input.resetPeriod,
    });
    return this.toSummary(row, false); // a brand-new feature can't be referenced by any package yet
  }

  /**
   * @throws {FeatureNotFoundError} if `id` doesn't resolve to any feature.
   * @throws {ValidationFailedError} if a supplied new `key` doesn't match the catalog key shape.
   * @throws {FeatureKeyImmutableError} if `input.key` is provided, differs from the current key, and
   *   the feature is already referenced by at least one package (FR-PKG-7's immutable-once-referenced
   *   rule).
   * @throws {FeatureKeyExistsError} if the (permitted) new key collides with a different feature.
   */
  async update(
    id: string,
    input: { key?: string; name?: string; description?: string | null; unit?: string; resetPeriod?: 'NONE' | 'DAILY' | 'MONTHLY' },
  ): Promise<FeatureSummary> {
    const row = await this.features.findById(id);
    if (!row) throw new FeatureNotFoundError();

    if (input.key !== undefined && input.key !== row.key) {
      if (!isValidCatalogKey(input.key)) {
        throw new ValidationFailedError([
          { field: 'key', constraint: 'key must be lowercase letters, numbers, and separators (. _ -) only, e.g. "exams.create".' },
        ]);
      }
      const referenced = (await this.features.countPackageReferences(id)) > 0;
      if (referenced) throw new FeatureKeyImmutableError();
      if (await this.features.existsByKey(input.key, id)) throw new FeatureKeyExistsError();
      row.key = input.key;
    }
    if (input.name !== undefined) row.name = input.name;
    if (input.description !== undefined) row.description = input.description;
    if (input.unit !== undefined) row.unit = input.unit;
    if (input.resetPeriod !== undefined) row.resetPeriod = input.resetPeriod;

    const saved = await this.features.save(row);
    const referenced = (await this.features.countPackageReferences(id)) > 0;
    return this.toSummary(saved, referenced);
  }

  /**
   * @throws {FeatureNotFoundError} if `id` doesn't resolve to any feature.
   * @throws {FeatureInUseError} if the feature is still referenced by at least one package.
   */
  async delete(id: string): Promise<void> {
    const row = await this.features.findById(id);
    if (!row) throw new FeatureNotFoundError();
    if ((await this.features.countPackageReferences(id)) > 0) {
      throw new FeatureInUseError();
    }
    await this.features.delete(id);
  }

  private toSummary(row: FeatureEntity, isReferenced: boolean): FeatureSummary {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      unit: row.unit,
      resetPeriod: row.resetPeriod,
      isReferenced,
      createdAt: row.createdAt,
    };
  }
}
