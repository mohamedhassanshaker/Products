import type { ApprovedAiModelEntity } from '@/server/infrastructure/database';
import type { PlatformTenantRepository } from '@/server/platform/tenants';
import type { ApprovedAiModelRepository } from '../infrastructure/approved-ai-model.repository';
import type { AiModelResolver } from './ai-model-resolver';
import {
  DefaultModelRequiredError,
  InvalidModelIdError,
  ModelAlreadyApprovedError,
  ModelDisabledError,
  ModelInUseError,
  ModelNotApprovedError,
  ModelNotFoundError,
} from '../domain/errors';
import type { ApprovedAiModelSummary } from '../domain/ai-model.types';

/** `provider/model[:variant]` shape (FR-AI-2) — lowercase/digits/`._-` segments either side of exactly
 * one `/`, with an optional `:variant` suffix on the model segment (e.g.
 * `anthropic/claude-3.5-haiku`, `openai/gpt-4o-mini:free`). Ported verbatim from
 * `legacy/api/src/platform/ai-models/application/ai-models.service.ts`. */
const OPEN_ROUTER_MODEL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i;

/**
 * Platform Admin CRUD + per-tenant assignment for `platform.approved_ai_model` (FR-AI-2/FR-AI-3,
 * migration plan Phase 2 sub-slice "2b") — the write-side counterpart to `AiModelResolver`'s read
 * path, and the sole place `tenant.assigned_ai_model_id` is ever mutated. Ported logic from
 * `legacy/api/src/platform/ai-models/application/ai-models.service.ts`.
 *
 * **Deliberately audit-agnostic** (like `TenantsService`/`PackagesService` in this app): a Route
 * Handler owns writing any future `platform.audit_log` row, because only it knows which HTTP action
 * happened and can read the acting admin id + request IP — matching this codebase's established
 * convention. No `platform/audit` module exists yet in this app (a later Phase 2 sub-dispatch's
 * scope), so no route in this dispatch writes one either — documented per-route, not silently omitted.
 *
 * Every mutation that can affect what any tenant currently resolves to calls
 * `AiModelResolver.invalidate()` synchronously in the same method.
 */
export class AiModelsService {
  constructor(
    private readonly models: ApprovedAiModelRepository,
    private readonly tenants: PlatformTenantRepository,
    private readonly resolver: AiModelResolver,
  ) {}

  async list(includeDisabled: boolean): Promise<ApprovedAiModelSummary[]> {
    const rows = await this.models.findAll(includeDisabled);
    return rows.map((row) => this.toSummary(row));
  }

  /** @throws {ModelNotFoundError} if `id` doesn't resolve to any allowlist row. */
  async get(id: string): Promise<ApprovedAiModelSummary> {
    const row = await this.models.findById(id);
    if (!row) throw new ModelNotFoundError();
    return this.toSummary(row);
  }

  /**
   * FR-AI-2: approves a new OpenRouter model. The very first approval ever auto-becomes the platform
   * default.
   *
   * @throws {InvalidModelIdError} if `openRouterModelId` doesn't match the required `provider/model`
   *   shape.
   * @throws {ModelAlreadyApprovedError} if `openRouterModelId` is already on the allowlist.
   */
  async approve(input: { openRouterModelId: string; displayName: string }): Promise<ApprovedAiModelSummary> {
    const openRouterModelId = input.openRouterModelId?.trim();
    if (!openRouterModelId || !OPEN_ROUTER_MODEL_ID_PATTERN.test(openRouterModelId)) {
      throw new InvalidModelIdError();
    }
    if (await this.models.findByOpenRouterModelId(openRouterModelId)) {
      throw new ModelAlreadyApprovedError();
    }

    const isFirstEver = (await this.models.count()) === 0;
    const row = await this.models.insert({
      openRouterModelId,
      displayName: input.displayName.trim(),
      makeDefault: isFirstEver,
    });
    // A brand-new model can only ever change resolution for a tenant that had no prior default at all
    // (the empty-allowlist → first-approval case) — invalidate everything defensively rather than
    // reasoning about which tenants that could be.
    this.resolver.invalidate();
    return this.toSummary(row);
  }

  /**
   * `PATCH /platform/ai-models/:id`: `displayName` update and/or `isEnabled` toggle.
   *
   * @throws {ModelNotFoundError} if `id` doesn't resolve to any allowlist row.
   * @throws {DefaultModelRequiredError} if `isEnabled: false` is requested for the current platform
   *   default — disabling it would leave the platform with a "default" that resolution must still
   *   treat as usable, so a replacement default must be designated first via {@link setDefault}.
   */
  async update(id: string, input: { displayName?: string; isEnabled?: boolean }): Promise<ApprovedAiModelSummary> {
    const row = await this.models.findById(id);
    if (!row) throw new ModelNotFoundError();

    if (input.isEnabled === false && row.isPlatformDefault) {
      throw new DefaultModelRequiredError();
    }

    if (input.displayName !== undefined) row.displayName = input.displayName.trim();
    if (input.isEnabled !== undefined) row.isEnabled = input.isEnabled;

    const saved = await this.models.save(row);
    if (input.isEnabled !== undefined) {
      // A disable/re-enable never changes *what* an already-assigned tenant resolves to, but it does
      // change whether the model is offered as a *new* assignment target — invalidating is cheap.
      this.resolver.invalidate();
    }
    return this.toSummary(saved);
  }

  /**
   * `PUT /platform/ai-models/:id/default`: atomically designates `id` the new platform default.
   *
   * @throws {ModelNotFoundError} if `id` doesn't resolve to any allowlist row.
   * @throws {ModelDisabledError} if the target model is currently disabled.
   */
  async setDefault(id: string): Promise<ApprovedAiModelSummary> {
    const row = await this.models.findById(id);
    if (!row) throw new ModelNotFoundError();
    if (!row.isEnabled) throw new ModelDisabledError();

    const saved = await this.models.setDefault(id);
    // Every tenant with no explicit assignment now resolves differently — invalidate the whole cache
    // rather than enumerate affected tenants.
    this.resolver.invalidate();
    return this.toSummary(saved);
  }

  /**
   * Hard-deletes an allowlist entry.
   *
   * @throws {ModelNotFoundError} if `id` doesn't resolve to any allowlist row.
   * @throws {DefaultModelRequiredError} if `id` is the current platform default.
   * @throws {ModelInUseError} (`details.tenantCount`) if any tenant is still explicitly assigned to
   *   `id`.
   */
  async remove(id: string): Promise<void> {
    const row = await this.models.findById(id);
    if (!row) throw new ModelNotFoundError();
    if (row.isPlatformDefault) throw new DefaultModelRequiredError();

    const tenantCount = await this.models.countTenantsAssigned(id);
    if (tenantCount > 0) throw new ModelInUseError(tenantCount);

    await this.models.remove(id);
    this.resolver.invalidate();
  }

  /**
   * FR-AI-3: assigns tenant `tenantId` to approved model `approvedAiModelId`, replacing any prior
   * explicit assignment.
   *
   * **Caller contract**: the caller (the `PUT /api/platform/tenants/:id/ai-model` route) has already
   * verified `tenantId` resolves to a real tenant and maps a missing one to `TENANT_NOT_FOUND` —
   * `platform/tenants` owns that error code, not `platform/ai-models` (a module doesn't throw another
   * bounded context's not-found code). If `tenantId` somehow doesn't exist, TypeORM's own
   * update-affects-zero-rows behavior is a silent no-op here, which is safe (there is nothing to
   * corrupt) but callers must not skip their own existence check.
   *
   * @throws {ModelNotApprovedError} if `approvedAiModelId` is not on the allowlist, or is currently
   *   disabled — one code for both, deliberately not enumerating which ids are disabled.
   */
  async assignToTenant(tenantId: string, approvedAiModelId: string): Promise<void> {
    const model = await this.models.findById(approvedAiModelId);
    if (!model || !model.isEnabled) throw new ModelNotApprovedError();

    await this.tenants.setAssignedAiModel(tenantId, approvedAiModelId);
    this.resolver.invalidate(tenantId);
  }

  /** "Clearing a tenant's explicit assignment... is idempotent and always succeeds" — reverts to
   * resolving via the platform default. No-op (still succeeds) if the tenant already had no explicit
   * assignment. Same caller contract as {@link assignToTenant} regarding `TENANT_NOT_FOUND`. */
  async unassignFromTenant(tenantId: string): Promise<void> {
    await this.tenants.setAssignedAiModel(tenantId, null);
    this.resolver.invalidate(tenantId);
  }

  /** The `PUT`/`DELETE /api/platform/tenants/:id/ai-model` routes both echo back `{source,
   * openRouterModelId, displayName}` — a thin, response-shaping wrapper over `AiModelResolver.resolve()`
   * so the caller sees the *result* of their assignment/unassignment immediately, without a second
   * round-trip. Also the read path the tenant detail screen's "AI model" panel uses to display the
   * currently-effective model. */
  async resolveEffectiveModel(tenantId: string): Promise<{ source: 'assigned' | 'platform_default'; openRouterModelId: string; displayName: string }> {
    const selection = await this.resolver.resolve(tenantId);
    return {
      source: selection.source,
      openRouterModelId: selection.primary.openRouterModelId,
      displayName: selection.primary.displayName,
    };
  }

  private toSummary(row: ApprovedAiModelEntity): ApprovedAiModelSummary {
    return {
      id: row.id,
      openRouterModelId: row.openRouterModelId,
      displayName: row.displayName,
      isEnabled: row.isEnabled,
      isPlatformDefault: row.isPlatformDefault,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
