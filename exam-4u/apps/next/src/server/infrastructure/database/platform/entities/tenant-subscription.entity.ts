import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM mapping for `platform.tenant_subscription` (LLD §4 DDL) — ported verbatim from
 * `legacy/api/src/infrastructure/database/platform/entities/tenant-subscription.entity.ts`.
 * `CreateSubscriptionStep` is this dispatch's only writer — it inserts exactly one `ACTIVE` row per
 * tenant against the real, migration-seeded catalog package. Reassignment/Stripe-driven status
 * transitions are Phase 2 scope.
 */
@Entity({ name: 'tenant_subscription' })
export class TenantSubscriptionEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'tenant_id', type: 'char', length: 36 })
  tenantId!: string;

  @Column({ name: 'package_id', type: 'char', length: 36 })
  packageId!: string;

  @Column({ type: 'enum', enum: ['ACTIVE', 'PAST_DUE', 'CANCELED'], default: 'ACTIVE' })
  status!: 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

  @Column({ name: 'provider_customer_id', type: 'varchar', length: 255, nullable: true })
  providerCustomerId!: string | null;

  @Column({ name: 'provider_subscription_id', type: 'varchar', length: 255, nullable: true })
  providerSubscriptionId!: string | null;

  @Column({ name: 'current_period_start', type: 'datetime', precision: 3, nullable: true })
  currentPeriodStart!: Date | null;

  @Column({ name: 'current_period_end', type: 'datetime', precision: 3, nullable: true })
  currentPeriodEnd!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
