import { In, IsNull, LessThanOrEqual, type DataSource, type FindOptionsWhere, type Repository } from 'typeorm';
import { TenantEntity } from '@/server/infrastructure/database';
import type { TenantStatus } from '@examland/contracts';

/** Options accepted by {@link PlatformTenantRepository.findMany}. */
export interface FindManyOptions {
  status?: TenantStatus;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
}

/** The narrow projection tenant-resolution needs — ported verbatim from legacy's
 * `ResolvedTenant` shape (`legacy/api/src/tenancy/domain/tenant-resolution.types.ts`). Not consumed
 * by anything yet this dispatch (`middleware.ts` is a later Phase 1 sub-dispatch); kept here so that
 * sub-dispatch's tenant-resolution cache can call {@link PlatformTenantRepository.findResolvableBySlug}
 * directly instead of re-deriving this read path from scratch. */
export interface ResolvedTenant {
  id: string;
  subdomainSlug: string;
  schemaName: string;
  status: TenantStatus;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * The sole place that ever queries `platform.tenant` — ported verbatim (logic unchanged) from
 * `legacy/api/src/platform/tenants/infrastructure/repositories/tenant.repository.ts`, adapted from a
 * NestJS `@Injectable()` provider (constructor-`@Inject(PLATFORM_DATA_SOURCE)`) to a plain class
 * this module's barrel constructs with an already-initialized `DataSource` (no DI container in this
 * app).
 */
export class PlatformTenantRepository {
  private readonly repo: Repository<TenantEntity>;

  constructor(dataSource: DataSource) {
    // String-name lookup, not the class reference (fixed Phase 1 sub-slice 1b — see
    // `server/tenancy/raw-tenant-lookup.ts`'s doc comment): Next.js can bundle this source file into
    // more than one webpack chunk/route entry, producing distinct `TenantEntity` class objects whose
    // *minified* `.name` no longer matches across bundles in production, which breaks TypeORM's
    // fallback class-identity metadata lookup (`EntityMetadataNotFoundError`, found by actually
    // booting the app and sending a real HTTP request — not caught by any vitest-only test, which
    // never crosses a real webpack bundle boundary). A literal string is immune to that.
    this.repo = dataSource.getRepository<TenantEntity>('tenant');
  }

  /**
   * Finds a non-soft-deleted tenant by its subdomain slug (HLD §4.2: "`SELECT ... WHERE
   * subdomain_slug=? AND deleted_at IS NULL`"), projected to the narrow shape tenant resolution
   * caches. `null` if no such tenant exists — never throws for a not-found lookup.
   */
  async findResolvableBySlug(slug: string): Promise<ResolvedTenant | null> {
    const row = await this.repo.findOne({ where: { subdomainSlug: slug, deletedAt: IsNull() } });
    if (!row) return null;
    return { id: row.id, subdomainSlug: row.subdomainSlug, schemaName: row.schemaName, status: row.status };
  }

  /** Same projection as {@link findResolvableBySlug}, keyed by id — used by worker code entering
   * tenant scope by id rather than subdomain. */
  async findResolvableById(id: string): Promise<ResolvedTenant | null> {
    const row = await this.repo.findOne({ where: { id, deletedAt: IsNull() } });
    if (!row) return null;
    return { id: row.id, subdomainSlug: row.subdomainSlug, schemaName: row.schemaName, status: row.status };
  }

  /** Persists a brand-new tenant row. Callers (`TenantsService.create`) are responsible for having
   * already validated/generated every field — this method performs no business validation itself. */
  async insert(data: Partial<TenantEntity>): Promise<TenantEntity> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  /**
   * Whether any tenant — including a soft-deleted one — already occupies `slug`. Deliberately
   * ignores `deletedAt`: MySQL's `uq_tenant_slug` unique key has no partial/filtered form, so a
   * subdomain remains reserved for a tenant's full retention window even after soft-delete, matching
   * FR-MT-1's "unique platform-wide, immutable once set".
   */
  async existsBySlug(slug: string): Promise<boolean> {
    const count = await this.repo.count({ where: { subdomainSlug: slug } });
    return count > 0;
  }

  /** Finds a tenant by id regardless of `deletedAt` — a soft-deleted tenant must still be viewable. */
  async findById(id: string): Promise<TenantEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Paginated, optionally status/soft-delete-filtered listing, newest first. */
  async findMany(options: FindManyOptions): Promise<{ items: TenantEntity[]; total: number }> {
    const page = options.page && options.page > 0 ? Math.floor(options.page) : 1;
    const pageSize =
      options.pageSize && options.pageSize > 0 ? Math.min(Math.floor(options.pageSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

    const where: FindOptionsWhere<TenantEntity> = {};
    if (options.status) where.status = options.status;
    if (!options.includeDeleted) where.deletedAt = IsNull();

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total };
  }

  /** Persists an already-mutated entity (status transitions, soft-delete). Callers own the business
   * rule that decided the mutation was valid — this is a thin `save()`, not a state machine. */
  async save(entity: TenantEntity): Promise<TenantEntity> {
    return this.repo.save(entity);
  }

  // ── Provisioning bookkeeping ───────────────────────────────────────────────────────────────────

  /** Persists the first Tenant Admin's invited email so a later `retry` can re-run `seed_admin_user`
   * without the caller resupplying it. */
  async setPendingAdminEmail(id: string, email: string): Promise<void> {
    await this.repo.update({ id }, { pendingAdminEmail: email });
  }

  /** Refreshes `provisioning_heartbeat_at` to "now" — called before running each step, so a future
   * maintenance worker can distinguish "actively provisioning right now" from "crashed mid-step". */
  async touchProvisioningHeartbeat(id: string): Promise<void> {
    await this.repo.update({ id }, { provisioningHeartbeatAt: new Date() });
  }

  /** Transitions a tenant to `Active` once every provisioning step has completed (FR-MT-4: "never
   * leaves a partially-usable tenant reachable by end users"). Clears any stale `provisioningError`
   * from an earlier failed attempt. */
  async markProvisioningActive(id: string): Promise<TenantEntity> {
    await this.repo.update({ id }, { status: 'Active', provisioningError: null });
    const row = await this.findById(id);
    if (!row) throw new Error(`Tenant ${id} vanished mid-provisioning (unexpected).`);
    return row;
  }

  /** Transitions a tenant to `Failed` with a recorded, client-visible reason (FR-MT-4). */
  async markProvisioningFailed(id: string, reason: string): Promise<void> {
    await this.repo.update({ id }, { status: 'Failed', provisioningError: reason });
  }

  /** Tenants whose provisioning appears stuck: still `Provisioning`/`Failed` with a
   * `provisioningHeartbeatAt` that is either never set or older than `staleMs`. Not consumed yet this
   * dispatch (a maintenance worker is Phase 2/10 scope) — kept for that later phase to reuse rather
   * than re-derive. */
  async findStuckProvisioning(staleMs: number): Promise<TenantEntity[]> {
    const cutoff = new Date(Date.now() - staleMs);
    return this.repo.find({
      where: [
        { status: 'Provisioning', provisioningHeartbeatAt: IsNull(), deletedAt: IsNull() },
        { status: 'Provisioning', provisioningHeartbeatAt: LessThanOrEqual(cutoff), deletedAt: IsNull() },
        { status: 'Failed', provisioningHeartbeatAt: IsNull(), deletedAt: IsNull() },
        { status: 'Failed', provisioningHeartbeatAt: LessThanOrEqual(cutoff), deletedAt: IsNull() },
      ],
    });
  }

  // ── AI model assignment (FR-AI-3, migration plan Phase 2 sub-slice 2b) ────────────────────────

  /** Sets (or clears, via `null`) a tenant's explicit `assigned_ai_model_id` — the sole write path
   * `server/platform/ai-models`' `AiModelsService.assignToTenant`/`unassignFromTenant` use. Trusts the
   * caller to have already validated `approvedAiModelId` against the allowlist (`MODEL_NOT_APPROVED`)
   * — this is a thin `update()`, not a business-rule enforcement point. A `tenantId` that doesn't
   * resolve to any row is a silent no-op (TypeORM's own update-affects-zero-rows behavior) — callers
   * must independently verify the tenant exists first (`TenantsService.get`) so `TENANT_NOT_FOUND` is
   * owned by `platform/tenants`, not `platform/ai-models` (a module doesn't throw another bounded
   * context's not-found code). */
  async setAssignedAiModel(tenantId: string, approvedAiModelId: string | null): Promise<void> {
    await this.repo.update({ id: tenantId }, { assignedAiModelId: approvedAiModelId });
  }

  /**
   * HLD §9/§10.1: soft-deleted tenants whose `purge_after_at` has already passed — used by
   * `TenantMaintenanceWorker.listPurgeEligibleTenants` (Phase 2 sub-slice "2d"). This is a **listing**
   * only — `TENANT_PURGE_ENABLED` gates whether anything ever actually acts on this list (default
   * `false`, HLD §9: "Automatic purge is off by default... the maintenance worker only lists
   * purge-eligible tenants for a Platform Admin to confirm"), and no code path in this app performs
   * the actual schema-drop/storage-prefix-delete purge itself — that remains a Platform Admin's
   * explicit, out-of-this-dispatch's-scope action. Ported verbatim from legacy's identically-named
   * method.
   */
  async findPurgeEligible(): Promise<TenantEntity[]> {
    const now = new Date();
    return this.repo.find({
      where: { deletedAt: LessThanOrEqual(now), purgeAfterAt: LessThanOrEqual(now) },
      order: { deletedAt: 'ASC' },
    });
  }

  /** Tenants eligible for a future migration-rollout tool: `Active` or `Suspended`, never
   * soft-deleted. Not consumed yet this dispatch — kept for the ops-tooling phase that needs it. */
  async findMigratable(tenantIds?: string[]): Promise<TenantEntity[]> {
    const where: FindOptionsWhere<TenantEntity> = {
      status: In(['Active', 'Suspended']) as unknown as TenantEntity['status'],
      deletedAt: IsNull(),
    };
    if (tenantIds && tenantIds.length > 0) {
      where.id = In(tenantIds) as unknown as TenantEntity['id'];
    }
    return this.repo.find({ where, order: { createdAt: 'ASC' } });
  }
}
