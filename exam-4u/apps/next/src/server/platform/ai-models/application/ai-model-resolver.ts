import { getEnv } from '@/server/config';
import type { PlatformTenantRepository } from '@/server/platform/tenants';
import type { ApprovedAiModelRepository } from '../infrastructure/approved-ai-model.repository';
import { AiNotConfiguredError } from '../domain/errors';
import type { AiModelSelection } from '../domain/ai-model.types';

interface CacheRecord {
  value: AiModelSelection;
  expiresAt: number;
}

/**
 * Resolves a tenant's effective AI model (FR-AI-2/FR-AI-3) — **the only source of a model id anywhere
 * in the system**, once an actual LLM call path exists to consume it. Ported logic from
 * `legacy/api/src/platform/ai-models/application/ai-model-resolver.ts`, adapted to a plain class this
 * module's barrel constructs (no DI container/`OnModuleDestroy` — this class exposes its own
 * {@link dispose} instead, called from the barrel's teardown if one is ever needed).
 *
 * **Scope note (migration plan Phase 2 sub-slice "2b")**: this dispatch ports the resolver itself
 * (needed by `AiModelsService`'s own `invalidate()` calls and by this dispatch's own admin-console
 * "effective model" display, `AiModelsService.resolveEffectiveModel`) but does **not** wire it into
 * any actual OpenRouter/LLM call — that consumption is explicitly Phase 5's job per the migration
 * plan's own phase sequence ("AI & vector platform layer"). Building the resolver now, without a real
 * consumer yet, mirrors this app's own established precedent for a forward-referenced dependency (see
 * `tenant.entity.ts`'s `assignedAiModelId` column comment) — it is fully data-correct and unit-tested
 * today; only its eventual caller is deferred.
 *
 * Resolution order (deliberately only two steps, no third fallback):
 * 1. `tenant.assigned_ai_model_id` → that row, **even if `is_enabled = 0`** (disabling a model must
 *    never break an already-configured tenant, FR-AI-2).
 * 2. Else the row with `is_platform_default = 1` (always enabled — `AiModelsService` refuses to make
 *    a disabled model the default).
 * 3. Else throws {@link AiNotConfiguredError} (503) — there is no hard-coded model of last resort.
 *
 * `fallback` in the returned {@link AiModelSelection} is the platform default's model id, present only
 * when it differs from `primary`.
 *
 * Cached per-tenant for `AI_MODEL_CACHE_TTL_MS` (60s default), invalidated synchronously by every
 * `AiModelsService` allowlist/assignment mutation — the identical pattern and accepted staleness
 * trade-off as `server/tenancy`'s tenant-resolution cache (Phase 1b).
 */
export class AiModelResolver {
  private readonly cache = new Map<string, CacheRecord>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(
    private readonly tenants: PlatformTenantRepository,
    private readonly models: ApprovedAiModelRepository,
  ) {
    // Bounds unbounded growth from a large tenant population — a periodic sweep of expired entries,
    // unref'd so it never keeps the Node process alive (matches every other interval timer this app
    // constructs, e.g. `server/reliability`'s outbox publisher tick).
    const ttlMs = Math.max(1000, getEnv().AI_MODEL_CACHE_TTL_MS);
    this.sweepTimer = setInterval(() => this.sweepExpired(), ttlMs).unref();
  }

  /** @throws {AiNotConfiguredError} if the tenant has no explicit assignment and the allowlist has no
   * current platform default (i.e. it is empty). */
  async resolve(tenantId: string): Promise<AiModelSelection> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    const selection = await this.computeSelection(tenantId);
    this.cache.set(tenantId, { value: selection, expiresAt: Date.now() + Math.max(1000, getEnv().AI_MODEL_CACHE_TTL_MS) });
    return selection;
  }

  /** Explicit same-instance invalidation. Called by `AiModelsService` after every allowlist mutation
   * (no `tenantId` — every cached tenant may be affected, e.g. a default change) or after a specific
   * tenant's assignment changes (`tenantId` given, only that entry is dropped). */
  invalidate(tenantId?: string): void {
    if (tenantId) {
      this.cache.delete(tenantId);
    } else {
      this.cache.clear();
    }
  }

  /** Stops the background sweep timer — not called anywhere in this app yet (no process-lifecycle
   * teardown hook exists for a singleton composed on `globalThis`), kept for symmetry/testability
   * (a unit test can construct a resolver, assert behavior, then dispose it without leaking a live
   * timer past the test). */
  dispose(): void {
    clearInterval(this.sweepTimer);
  }

  private async computeSelection(tenantId: string): Promise<AiModelSelection> {
    const tenant = await this.tenants.findById(tenantId);
    const platformDefault = await this.models.findPlatformDefault();

    if (tenant?.assignedAiModelId) {
      const assigned = await this.models.findById(tenant.assignedAiModelId);
      if (assigned) {
        const primary = { openRouterModelId: assigned.openRouterModelId, displayName: assigned.displayName };
        const fallback =
          platformDefault && platformDefault.id !== assigned.id
            ? { openRouterModelId: platformDefault.openRouterModelId, displayName: platformDefault.displayName }
            : undefined;
        return { source: 'assigned', primary, fallback };
      }
      // The FK's `ON DELETE RESTRICT` makes an assigned model vanishing out from under a tenant
      // structurally impossible in normal operation — this branch only guards against that invariant
      // somehow being violated (e.g. direct DB tampering), falling through to the platform default
      // rather than throwing, consistent with "disabling must not break an already-configured tenant."
    }

    if (platformDefault) {
      return {
        source: 'platform_default',
        primary: { openRouterModelId: platformDefault.openRouterModelId, displayName: platformDefault.displayName },
      };
    }

    throw new AiNotConfiguredError();
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [tenantId, record] of this.cache) {
      if (now >= record.expiresAt) this.cache.delete(tenantId);
    }
  }
}
