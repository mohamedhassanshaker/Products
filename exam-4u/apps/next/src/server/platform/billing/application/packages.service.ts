import type { PackageEntity } from '@/server/infrastructure/database';
import { isValidCatalogKey } from '@/server/common/util/catalog-key.util';
import { ValidationFailedError } from '@/server/common/errors/domain-error';
import { FeatureNotFoundError, PackageKeyExistsError, PackageNotFoundError } from '../domain/errors';
import type { PackageRepository } from '../infrastructure/package.repository';
import type { PackageFeatureRepository } from '../infrastructure/package-feature.repository';
import type { FeatureRepository } from '../infrastructure/feature.repository';

/** True if `err` is a real MySQL duplicate-entry error (`ER_DUP_ENTRY`/errno `1062`) surfaced through
 * TypeORM's `QueryFailedError` — checked structurally (duck-typed `code`/`errno` fields), not via an
 * `instanceof` import of TypeORM's `QueryFailedError` class, to avoid this application-layer service
 * taking on a direct TypeORM-error-class dependency for one narrow check. Used to close the
 * check-then-act race documented on {@link PackagesService.create} above. */
function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number } | undefined;
  return e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062;
}

/** Plain-data projection of a `platform.package` row (controllers never consume the entity
 * directly). */
export interface PackageSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A package's current feature configuration — one entry per *configured* (i.e. currently enabled)
 * feature, matching `package_feature`'s own default-deny-by-absence shape — the client reconciles
 * this against the full feature catalog to render the association picker's unchecked rows. */
export interface PackageFeatureConfigSummary {
  featureId: string;
  limit: number | null;
}

export interface PackageDetail extends PackageSummary {
  features: PackageFeatureConfigSummary[];
}

/**
 * Platform Admin catalog CRUD for `platform.package`/`platform.package_feature` (FR-PKG-7, migration
 * plan Phase 2 sub-slice "2b") — the write-side counterpart to Phase 1a's read-only
 * `PackageRepository`/`PackageFeatureRepository`. Ported logic from
 * `legacy/api/src/platform/packages/application/packages.service.ts`.
 *
 * **Depends on `FeatureRepository` directly** (a plain TS import, this module's own sibling
 * repository — `platform/billing` already owns both entities per Phase 1a's consolidation decision,
 * so there is no cross-module dependency/cycle risk here at all, unlike legacy's separate-module
 * split which needed to reason about a `PackagesModule`↔`FeaturesModule` import direction).
 */
export class PackagesService {
  constructor(
    private readonly packages: PackageRepository,
    private readonly packageFeatures: PackageFeatureRepository,
    private readonly features: FeatureRepository,
  ) {}

  async list(): Promise<PackageSummary[]> {
    const rows = await this.packages.findAll();
    return rows.map((row) => this.toSummary(row));
  }

  /** Every currently-active package — a future tenant-subscription reassignment dropdown's source
   * list (inactive packages are never offered as a *new* assignment target). Not consumed by any UI
   * this dispatch (`?activeOnly=true` is wired at the route layer for that later sub-dispatch to
   * reuse). */
  async listActive(): Promise<PackageSummary[]> {
    const rows = await this.packages.findAllActive();
    return rows.map((row) => this.toSummary(row));
  }

  /** @throws {PackageNotFoundError} if `id` doesn't resolve to any package. */
  async get(id: string): Promise<PackageDetail> {
    const row = await this.packages.findById(id);
    if (!row) throw new PackageNotFoundError();
    const config = await this.packageFeatures.findByPackageId(id);
    return {
      ...this.toSummary(row),
      features: config.map((pf) => ({ featureId: pf.featureId, limit: pf.limit })),
    };
  }

  /**
   * @throws {ValidationFailedError} if `input.key` doesn't match the catalog key shape.
   * @throws {PackageKeyExistsError} if `input.key` collides with an existing package.
   */
  async create(input: {
    key: string;
    name: string;
    description?: string | null;
    priceCents: number;
    isActive?: boolean;
    sortOrder?: number;
  }): Promise<PackageSummary> {
    const key = input.key?.trim();
    if (!key || !isValidCatalogKey(key)) {
      throw new ValidationFailedError([
        { field: 'key', constraint: 'key must be lowercase letters, numbers, and separators (. _ -) only, e.g. "pro".' },
      ]);
    }
    if (await this.packages.existsByKey(key)) {
      throw new PackageKeyExistsError();
    }
    // **Real concurrency finding (Phase 10 sub-slice "10b1"'s own genuine-concurrency e2e proof)**:
    // the `existsByKey` check above and the `create` insert below are two separate round trips — two
    // concurrent requests for the identical `key` can both pass the check (neither row exists yet)
    // before either insert commits, a classic check-then-act TOCTOU race. The database's own
    // `uq_package_key` unique index is the real, final arbiter (exactly as intended — this is why the
    // index exists at all), but until this fix, the *second* insert's unique-constraint violation
    // propagated as a raw, untranslated `QueryFailedError` all the way to the HTTP boundary as a bare
    // `500 INTERNAL_ERROR` instead of the intended `409 PACKAGE_KEY_EXISTS` — found by this dispatch's
    // own `Promise.all` double-POST e2e test actually racing two real requests against the live
    // container (a sequential-calls-only test would never have caught this, since the first check
    // always passes when calls are awaited one at a time). Catching the DB's own duplicate-key error
    // here and re-throwing the correct domain error closes the race with no user-visible behavior
    // change for the already-covered sequential case (`existsByKey`'s pre-check keeps that path fast
    // and avoids relying on the DB error code for the common case).
    try {
      const row = await this.packages.create({
        key,
        name: input.name,
        description: input.description ?? null,
        priceCents: input.priceCents,
        // Currency is platform-fixed — never client-supplied (matches the single-currency assumption a
        // later billing sub-dispatch's own Stripe design will make: "single-price, monthly-interval").
        currency: 'usd',
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
      });
      return this.toSummary(row);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new PackageKeyExistsError();
      }
      throw err;
    }
  }

  /**
   * @throws {PackageNotFoundError} if `id` doesn't resolve to any package.
   * @throws {ValidationFailedError} if a supplied new `key` doesn't match the catalog key shape.
   * @throws {PackageKeyExistsError} if the (permitted) new key collides with a different package.
   */
  async update(
    id: string,
    input: { key?: string; name?: string; description?: string | null; priceCents?: number; isActive?: boolean; sortOrder?: number },
  ): Promise<PackageSummary> {
    const row = await this.packages.findById(id);
    if (!row) throw new PackageNotFoundError();

    if (input.key !== undefined && input.key !== row.key) {
      if (!isValidCatalogKey(input.key)) {
        throw new ValidationFailedError([
          { field: 'key', constraint: 'key must be lowercase letters, numbers, and separators (. _ -) only, e.g. "pro".' },
        ]);
      }
      if (await this.packages.existsByKey(input.key, id)) throw new PackageKeyExistsError();
      row.key = input.key;
    }
    if (input.name !== undefined) row.name = input.name;
    if (input.description !== undefined) row.description = input.description;
    if (input.priceCents !== undefined) row.priceCents = input.priceCents;
    if (input.isActive !== undefined) row.isActive = input.isActive;
    if (input.sortOrder !== undefined) row.sortOrder = input.sortOrder;

    const saved = await this.packages.save(row);
    return this.toSummary(saved);
  }

  /**
   * Atomic full replace of a package's feature configuration (`PUT /platform/packages/:id/features`).
   * Validates every referenced `featureId` exists *before* writing anything, so a bad id never leaves
   * a partially-applied configuration.
   *
   * @throws {PackageNotFoundError} if `id` doesn't resolve to any package.
   * @throws {FeatureNotFoundError} if any `featureId` in `items` doesn't resolve to any catalog
   *   feature.
   */
  async replaceFeatures(id: string, items: { featureId: string; limit?: number | null }[]): Promise<PackageDetail> {
    const row = await this.packages.findById(id);
    if (!row) throw new PackageNotFoundError();

    if (items.length > 0) {
      const found = await this.features.findByIds(items.map((i) => i.featureId));
      if (found.length !== new Set(items.map((i) => i.featureId)).size) {
        throw new FeatureNotFoundError();
      }
    }

    await this.packageFeatures.replaceForPackage(
      id,
      items.map((item) => ({ featureId: item.featureId, limit: item.limit ?? null })),
    );
    return this.get(id);
  }

  private toSummary(row: PackageEntity): PackageSummary {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      priceCents: row.priceCents,
      currency: row.currency,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
