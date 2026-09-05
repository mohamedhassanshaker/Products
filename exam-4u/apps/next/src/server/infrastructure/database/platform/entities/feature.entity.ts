import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for `platform.feature` (LLD §4 DDL, FR-PKG-1) — ported verbatim from
 * `legacy/api/src/infrastructure/database/platform/entities/feature.entity.ts`. The platform-wide
 * catalog of gated capabilities (`key` — `domain.action` naming convention, e.g. `exams.create`) each
 * package configures via {@link import('./package-feature.entity').PackageFeatureEntity}.
 */
@Entity({ name: 'feature' })
export class FeatureEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 50 })
  unit!: string;

  /** FR-PKG-1: `NONE` denotes a lifetime cap (never reset), not a recurring one. */
  @Column({ name: 'reset_period', type: 'enum', enum: ['NONE', 'DAILY', 'MONTHLY'], default: 'MONTHLY' })
  resetPeriod!: 'NONE' | 'DAILY' | 'MONTHLY';

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
