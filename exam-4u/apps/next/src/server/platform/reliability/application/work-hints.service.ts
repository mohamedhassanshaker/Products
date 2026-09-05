import type { TenantWorkHintKind } from '@/server/infrastructure/database';
import type { WorkHintRepository } from '../infrastructure/work-hint.repository';

/**
 * Application-layer facade over {@link WorkHintRepository} — ported logic (not code) from
 * `legacy/api/src/platform/reliability/application/work-hints.service.ts`'s `WorkHintsService`. Exists
 * purely so other modules can read `tenant_work_hint` without deep-importing this module's own
 * repository (module-boundary rule) — the identical pattern `platform/tenants`' own
 * `TenantsService`/`PlatformTenantRepository` split already establishes. Carries no logic of its own
 * beyond delegation; `WorkHintRepository`'s own doc comment covers the actual read/clear semantics.
 */
export class WorkHintsService {
  constructor(private readonly repo: WorkHintRepository) {}

  /** Tenant ids with a pending hint of `kind`, oldest-first, capped at `limit`. */
  async listTenantIds(kind: TenantWorkHintKind, limit: number): Promise<string[]> {
    return this.repo.listTenantIds(kind, limit);
  }

  /** Count of tenants currently carrying a pending hint of `kind` — the Reliability dashboard's own
   * read path. */
  async countByKind(kind: TenantWorkHintKind): Promise<number> {
    return this.repo.countByKind(kind);
  }

  /** Clears a tenant's hint for `kind` once its queue of that kind is confirmed drained. */
  async clear(tenantId: string, kind: TenantWorkHintKind): Promise<void> {
    await this.repo.clear(tenantId, kind);
  }
}
