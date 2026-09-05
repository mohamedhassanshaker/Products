import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for `platform.package_feature` (LLD §4 DDL, FR-PKG-3) — ported verbatim from
 * `legacy/api/src/infrastructure/database/platform/entities/package-feature.entity.ts`. Configures,
 * per `(package, feature)` pair, whether the feature is `enabled` and — if enabled — an optional
 * `limit` per reset period (`NULL` = unlimited). A `(package, feature)` pair with **no row at all** is
 * the default-deny case (FR-PKG-3: "a feature absent from a package's configuration is treated as
 * disabled... not default-allow") — the feature-usage phase (not yet built) must treat a missing row
 * identically to an `enabled=false` row, never as "unlimited"/"allowed".
 */
@Entity({ name: 'package_feature' })
export class PackageFeatureEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'package_id', type: 'char', length: 36 })
  packageId!: string;

  @Column({ name: 'feature_id', type: 'char', length: 36 })
  featureId!: string;

  /** `NULL` = unlimited use of this feature on this package. */
  @Column({ type: 'int', nullable: true })
  limit!: number | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;
}
