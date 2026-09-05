import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import type { ProvisioningStepName } from '@examland/contracts';
import { TenantProvisioningStepEntity } from '@/server/infrastructure/database';

/**
 * The sole place that ever queries `platform.tenant_provisioning_step` — ported verbatim (logic
 * unchanged) from `legacy/api/src/tenancy/provisioning/tenant-provisioning-step.repository.ts`,
 * adapted to a plain class taking an already-initialized `DataSource` (no DI container). The step
 * ledger HLD §4.4 relies on to make "re-run resumes rather than duplicates" true. Every method is
 * idempotent by construction (natural-key upsert on `(tenant_id, step)`), matching HLD §4.4's "every
 * step is written to be independently idempotent" for the ledger itself, not just the tenant-schema
 * side effects each step produces.
 */
export class TenantProvisioningStepRepository {
  private readonly repo: Repository<TenantProvisioningStepEntity>;

  constructor(dataSource: DataSource) {
    // String-name lookup, not the class reference (fixed Phase 1 sub-slice 1b — see
    // `server/tenancy/raw-tenant-lookup.ts`'s doc comment for the cross-webpack-bundle
    // entity-class-identity mismatch this avoids).
    this.repo = dataSource.getRepository<TenantProvisioningStepEntity>('tenant_provisioning_step');
  }

  /** Fetches the ledger row for `(tenantId, step)`, or `null` if this step has never been attempted
   * for this tenant (first run). */
  async find(tenantId: string, step: ProvisioningStepName): Promise<TenantProvisioningStepEntity | null> {
    return this.repo.findOne({ where: { tenantId, step } });
  }

  /** Marks a step `Running`, incrementing `attempts` and stamping `started_at`. Creates the row on
   * first attempt (`Pending` was never a persisted intermediate state worth a separate write). */
  async markRunning(tenantId: string, step: ProvisioningStepName): Promise<void> {
    const existing = await this.find(tenantId, step);
    if (existing) {
      await this.repo.update(
        { id: existing.id },
        { status: 'Running', attempts: existing.attempts + 1, startedAt: new Date() },
      );
      return;
    }
    await this.repo.insert({
      id: randomUUID(),
      tenantId,
      step,
      status: 'Running',
      attempts: 1,
      error: null,
      startedAt: new Date(),
      completedAt: null,
    });
  }

  /** Marks a step `Completed`. Idempotent — calling this twice for the same step just overwrites
   * `completed_at`, never creates a duplicate row (`(tenant_id, step)` is the natural key). */
  async markCompleted(tenantId: string, step: ProvisioningStepName): Promise<void> {
    await this.repo.update({ tenantId, step }, { status: 'Completed', completedAt: new Date(), error: null });
  }

  /** Marks a step `Failed` with the given reason, visible to Platform Admins without needing to
   * inspect application logs (FR-MT-4). */
  async markFailed(tenantId: string, step: ProvisioningStepName, reason: string): Promise<void> {
    await this.repo.update({ tenantId, step }, { status: 'Failed', error: reason });
  }

  /** All ledger rows for a tenant, in no particular guaranteed order — used by tests/diagnostics to
   * assert the full step history (e.g. "attempts stayed at 1 for an already-Completed step across a
   * retry"). */
  async findAllForTenant(tenantId: string): Promise<TenantProvisioningStepEntity[]> {
    return this.repo.find({ where: { tenantId } });
  }
}
