import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { ApprovedAiModelEntity, type TenantEntity } from '@/server/infrastructure/database';

/**
 * Data access over `platform.approved_ai_model` (FR-AI-2) plus the one `platform.tenant`-touching
 * query {@link countTenantsAssigned} needs — ported from
 * `legacy/api/src/platform/ai-models/infrastructure/repositories/approved-ai-model.repository.ts`.
 * Every mutation that must be atomic with clearing/setting the single default flag runs inside one
 * `DataSource.transaction()`.
 *
 * **Deliberately queries `tenant` directly here (via this repository's own `DataSource`, string-keyed
 * — see every constructor's own comment below) rather than depending on `PlatformTenantRepository`**:
 * `TenantEntity` lives in the shared, module-agnostic `infrastructure/database/platform/entities/**`
 * per this codebase's established convention (an entity import carries no module-ownership
 * implication) — matches `FeatureRepository`'s own identical "read the shared entity directly" choice
 * for `package_feature` (see that file's doc comment) rather than introducing a
 * `platform/ai-models`→`platform/tenants` dependency for one count query.
 */
export class ApprovedAiModelRepository {
  private readonly repo: Repository<ApprovedAiModelEntity>;

  constructor(private readonly dataSource: DataSource) {
    // String-name lookup, not the class reference (fixed Phase 1 sub-slice 1b — see
    // `server/tenancy/raw-tenant-lookup.ts`'s doc comment for the cross-webpack-bundle
    // entity-class-identity mismatch this avoids).
    this.repo = dataSource.getRepository<ApprovedAiModelEntity>('approved_ai_model');
  }

  async findById(id: string): Promise<ApprovedAiModelEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByOpenRouterModelId(openRouterModelId: string): Promise<ApprovedAiModelEntity | null> {
    return this.repo.findOne({ where: { openRouterModelId } });
  }

  /** The single row with `is_platform_default = true`, or `null` if the allowlist is empty
   * (`AiModelResolver`'s fallback step). */
  async findPlatformDefault(): Promise<ApprovedAiModelEntity | null> {
    return this.repo.findOne({ where: { isPlatformDefault: true } });
  }

  /** `includeDisabled=true` returns everything; otherwise only enabled rows — the Platform Admin
   * allowlist screen's own toggle, and the per-tenant assignment dropdown's source list (which must
   * never offer a disabled model as a *new* assignment target). Ordered by display name for a stable,
   * readable list. */
  async findAll(includeDisabled: boolean): Promise<ApprovedAiModelEntity[]> {
    return this.repo.find({
      where: includeDisabled ? {} : { isEnabled: true },
      order: { displayName: 'ASC' },
    });
  }

  /** How many *distinct* approved models currently exist at all — used by `AiModelsService.approve`
   * to decide "first-ever approval auto-becomes default". */
  async count(): Promise<number> {
    return this.repo.count();
  }

  /**
   * Inserts a new allowlist row. If `makeDefault` is `true`, sets `is_platform_default = 1` on the new
   * row in the **same transaction** as the insert ("approving the very first model auto-designates it
   * default") — there is no separate default row to clear yet in that case, since the table was empty.
   */
  async insert(input: { openRouterModelId: string; displayName: string; makeDefault: boolean }): Promise<ApprovedAiModelEntity> {
    return this.dataSource.transaction(async (manager) => {
      const id = randomUUID();
      await manager.insert('approved_ai_model', {
        id,
        openRouterModelId: input.openRouterModelId,
        displayName: input.displayName,
        isEnabled: true,
        isPlatformDefault: input.makeDefault,
      });
      const row = await manager.findOne('approved_ai_model', { where: { id } });
      if (!row) throw new Error(`Approved AI model ${id} vanished immediately after insert (unexpected).`);
      return row as ApprovedAiModelEntity;
    });
  }

  /** Persists an already-mutated, non-default-flag-touching field change (`displayName`/`isEnabled`).
   * Callers that touch `isPlatformDefault` must go through {@link setDefault} instead, since that flag
   * requires the atomic clear-then-set the DB's unique generated-column index demands. */
  async save(entity: ApprovedAiModelEntity): Promise<ApprovedAiModelEntity> {
    return this.repo.save(entity);
  }

  /**
   * Atomically clears whichever row currently holds `is_platform_default = 1` (if any) and sets it on
   * `id`, in one transaction (the unique index on the generated column means a non-atomic order would
   * transiently violate it — the clear must come first, in the same transaction).
   */
  async setDefault(id: string): Promise<ApprovedAiModelEntity> {
    return this.dataSource.transaction(async (manager) => {
      await manager.update('approved_ai_model', { isPlatformDefault: true }, { isPlatformDefault: false });
      await manager.update('approved_ai_model', { id }, { isPlatformDefault: true });
      const row = await manager.findOne('approved_ai_model', { where: { id } });
      if (!row) throw new Error(`Approved AI model ${id} vanished mid-set-default (unexpected).`);
      return row as ApprovedAiModelEntity;
    });
  }

  /** Hard-deletes an allowlist row. Callers (`AiModelsService.remove`) have already checked
   * `MODEL_IN_USE`/`DEFAULT_MODEL_REQUIRED` — this is a thin delete, not a state machine. The DB's own
   * `fk_tenant_ai_model ... ON DELETE RESTRICT` is the storage-level backstop if that check were ever
   * bypassed (defense in depth). */
  async remove(id: string): Promise<void> {
    await this.repo.delete({ id });
  }

  /** How many tenants currently have this model as their **explicit** assignment — the `MODEL_IN_USE`
   * count. Deliberately does not count tenants merely riding the platform default (an unassigned
   * tenant is not "using" this model in the sense `MODEL_IN_USE` protects against — it would simply
   * start using whatever the new default becomes). */
  async countTenantsAssigned(approvedAiModelId: string): Promise<number> {
    return this.dataSource.getRepository<TenantEntity>('tenant').count({ where: { assignedAiModelId: approvedAiModelId } });
  }
}
