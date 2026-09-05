import type { DataSource, Repository } from 'typeorm';
import { TenantWorkHintEntity, type TenantWorkHintKind } from '@/server/infrastructure/database';

/**
 * Platform-schema read side of `tenant_work_hint` (HLD §10.2) — ported logic (not code) from
 * `legacy/api/src/platform/reliability/infrastructure/repositories/work-hint.repository.ts`'s
 * `WorkHintRepository`, adapted to this app's DataSource-constructor convention. The *write* side (a
 * cross-schema upsert performed inside a tenant's own transaction) has no producer wired in this app
 * yet — see `TenantWorkHintEntity`'s own doc comment — which is why this class has no `upsert` method
 * of its own even though it owns the table's read queries.
 */
export class WorkHintRepository {
  private readonly repo: Repository<TenantWorkHintEntity>;

  constructor(dataSource: DataSource) {
    // String-name lookup, not the class reference — see `server/tenancy/raw-tenant-lookup.ts`'s doc
    // comment (cross-webpack-bundle entity-class-identity fix every repository in this app follows).
    this.repo = dataSource.getRepository<TenantWorkHintEntity>('tenant_work_hint');
  }

  /** Tenant ids with a pending hint of `kind`, oldest-`pending_since`-first (so a worker's hinted pass
   * naturally prioritizes the longest-waiting tenant), capped at `limit`. */
  async listTenantIds(kind: TenantWorkHintKind, limit: number): Promise<string[]> {
    const rows = await this.repo.find({ where: { kind }, order: { pendingSince: 'ASC' }, take: limit });
    return rows.map((r) => r.tenantId);
  }

  /** Count of tenants currently carrying a pending hint of `kind` — the Reliability dashboard's own
   * read path (no legacy precedent; legacy never built an admin-facing reliability viewer). */
  async countByKind(kind: TenantWorkHintKind): Promise<number> {
    return this.repo.count({ where: { kind } });
  }

  /** Removes a tenant's hint for `kind` once that tenant's queue of that kind has been fully drained —
   * called by the worker that just confirmed there is nothing left pending, never speculatively. A
   * no-op (not an error) if no such hint exists. */
  async clear(tenantId: string, kind: TenantWorkHintKind): Promise<void> {
    await this.repo.delete({ tenantId, kind });
  }
}
