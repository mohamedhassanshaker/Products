import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { ProvisioningStepName, ProvisioningStepStatus } from '@examland/contracts';

/**
 * TypeORM mapping for `platform.tenant_provisioning_step` (LLD §4 DDL) — ported verbatim from
 * `legacy/api/src/infrastructure/database/platform/entities/tenant-provisioning-step.entity.ts`. The
 * step ledger HLD §4.4 describes as "what makes 're-run resumes rather than duplicates' true without
 * relying on inspecting the tenant schema". One row per `(tenant_id, step)` pair (enforced by
 * `uq_prov_step`); `TenantProvisioningService` upserts this row before running a step and updates it
 * after, so the ledger — not the tenant schema's own contents — is always the source of truth for
 * "has this step already run".
 */
@Entity({ name: 'tenant_provisioning_step' })
export class TenantProvisioningStepEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'tenant_id', type: 'char', length: 36 })
  tenantId!: string;

  @Column({
    type: 'enum',
    enum: ['create_schema', 'run_migrations', 'seed_rbac', 'seed_admin_user', 'create_subscription', 'invite_admin'],
  })
  step!: ProvisioningStepName;

  @Column({ type: 'enum', enum: ['Pending', 'Running', 'Completed', 'Failed'], default: 'Pending' })
  status!: ProvisioningStepStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'started_at', type: 'datetime', precision: 3, nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'datetime', precision: 3, nullable: true })
  completedAt!: Date | null;
}
