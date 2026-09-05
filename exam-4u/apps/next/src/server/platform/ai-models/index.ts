import { getPlatformDataSource } from '@/server/infrastructure/database';
import { PlatformTenantRepository } from '@/server/platform/tenants';
import { ApprovedAiModelRepository } from './infrastructure/approved-ai-model.repository';
import { AiModelResolver } from './application/ai-model-resolver';
import { AiModelsService } from './application/ai-models.service';

export { ApprovedAiModelRepository, AiModelResolver, AiModelsService };
export type { ApprovedAiModelSummary, AiModelSelection } from './domain/ai-model.types';
export {
  InvalidModelIdError,
  ModelAlreadyApprovedError,
  ModelNotFoundError,
  DefaultModelRequiredError,
  ModelInUseError,
  ModelNotApprovedError,
  ModelDisabledError,
  AiNotConfiguredError,
} from './domain/errors';

/**
 * `server/platform/ai-models`'s public barrel (migration plan Phase 2 sub-slice "2b", FR-AI-2/FR-AI-3)
 * — the Platform Admin-curated OpenRouter model allowlist plus per-tenant assignment. Nothing outside
 * this module may import `./domain/**`/`./infrastructure/**`/`./application/**` directly (enforced by
 * `apps/next/.eslintrc.cjs`'s new `platform/ai-models` module-boundary rule, added this dispatch).
 *
 * **Scope note**: this module's own admin-facing allowlist CRUD + tenant-assignment data model/service
 * is this dispatch's job. `AiModelResolver`'s *consumption* by an actual OpenRouter/LLM call path is
 * explicitly Phase 5's job per the migration plan's own phase sequence — see `ai-model-resolver.ts`'s
 * own doc comment for the full reasoning. This barrel exposes {@link getAiModelResolver} as a shared
 * singleton specifically so Phase 5 can obtain the *same* cached instance `AiModelsService` already
 * invalidates, rather than constructing a second, out-of-sync resolver later.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandApprovedAiModelRepo: Promise<ApprovedAiModelRepository> | undefined;
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandAiModelTenantRepo: Promise<PlatformTenantRepository> | undefined;
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandAiModelResolver: Promise<AiModelResolver> | undefined;
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandAiModelsService: Promise<AiModelsService> | undefined;
}

async function getApprovedAiModelRepository(): Promise<ApprovedAiModelRepository> {
  if (!globalThis.__examlandApprovedAiModelRepo) {
    globalThis.__examlandApprovedAiModelRepo = getPlatformDataSource().then((ds) => new ApprovedAiModelRepository(ds));
  }
  return globalThis.__examlandApprovedAiModelRepo;
}

/** This module's own `PlatformTenantRepository` instance, sharing the same platform `DataSource`
 * singleton as `server/platform/tenants`'s own composition root but constructed independently here
 * (a plain, stateless repository class — constructing a second instance over the same `DataSource` is
 * cheap and avoids adding a new export surface to `platform/tenants`'s barrel just for this module's
 * own internal wiring need). */
async function getTenantRepositoryForAiModels(): Promise<PlatformTenantRepository> {
  if (!globalThis.__examlandAiModelTenantRepo) {
    globalThis.__examlandAiModelTenantRepo = getPlatformDataSource().then((ds) => new PlatformTenantRepository(ds));
  }
  return globalThis.__examlandAiModelTenantRepo;
}

/** Composition root for the shared {@link AiModelResolver} singleton — cached on `globalThis` for the
 * same Next.js dev-hot-reload reason every other async singleton in this app is (and so this module's
 * own periodic cache-sweep timer is only ever constructed once per process). */
export async function getAiModelResolver(): Promise<AiModelResolver> {
  if (!globalThis.__examlandAiModelResolver) {
    globalThis.__examlandAiModelResolver = Promise.all([getTenantRepositoryForAiModels(), getApprovedAiModelRepository()]).then(
      ([tenants, models]) => new AiModelResolver(tenants, models),
    );
  }
  return globalThis.__examlandAiModelResolver;
}

/** Composition root for {@link AiModelsService} — the Platform Admin allowlist CRUD + tenant-assignment
 * service. */
export async function getAiModelsService(): Promise<AiModelsService> {
  if (!globalThis.__examlandAiModelsService) {
    globalThis.__examlandAiModelsService = Promise.all([
      getApprovedAiModelRepository(),
      getTenantRepositoryForAiModels(),
      getAiModelResolver(),
    ]).then(([models, tenants, resolver]) => new AiModelsService(models, tenants, resolver));
  }
  return globalThis.__examlandAiModelsService;
}
