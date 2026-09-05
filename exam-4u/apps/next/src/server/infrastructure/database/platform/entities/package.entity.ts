import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM mapping for `platform.package` (LLD §4 DDL) — ported verbatim from
 * `legacy/api/src/infrastructure/database/platform/entities/package.entity.ts`. Seeded (idempotently,
 * via migration) with the real `starter`/`pro`/`enterprise` catalog rows — `starter` being the
 * `FALLBACK_PACKAGE_KEY` a `CANCELED` subscription falls back to and the package
 * `CreateSubscriptionStep` subscribes every newly-provisioned tenant to.
 *
 * Platform Admin CRUD over this table (create/edit packages) is Phase 2 scope (packages/features
 * admin console) — this dispatch only reads it (`PackageRepository`).
 */
@Entity({ name: 'package' })
export class PackageEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ name: 'price_cents', type: 'int', default: 0 })
  priceCents!: number;

  @Column({ type: 'char', length: 3, default: 'usd' })
  currency!: string;

  @Column({ name: 'stripe_price_id', type: 'varchar', length: 255, nullable: true })
  stripePriceId!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
