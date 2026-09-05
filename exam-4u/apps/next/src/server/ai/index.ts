import { getEnv } from '@/server/config';
import { requireTenantDataSource } from '@/server/context';
import { getEmbeddingsPort } from '@/server/infrastructure/embeddings';
import { getQdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { AiService } from './application/ai.service';
import { RetrievalService, type RetrievalScope, type RetrievedChunk } from './application/retrieval.service';
import { AiCallLogRepository } from './infrastructure/ai-call-log.repository';
import { PersistentAiUsageRecorder } from './infrastructure/ai-usage-recorder.persistent';
import { resolveModelForTenant } from './ai-model-resolver';
import { AiServiceDisabledAdapter } from './domain/ai-service-disabled.adapter';
import type { AiServicePort } from './domain/ai-service.port';

export { AiService, AiServiceDisabledAdapter, RetrievalService, AiCallLogRepository, PersistentAiUsageRecorder, resolveModelForTenant };
export type { RetrievalScope, RetrievedChunk };
export type { AiInvocationContext, AiResult, AiServicePort, AiUsage } from './domain/ai-service.port';
export type { AiUsageRecord, AiUsageRecorderPort } from './domain/ai-usage-recorder.port';
export { AiContractViolationError, AiDisabledError, AiProviderFailedError, AiServiceUnavailableError } from './domain/errors';

/**
 * `server/ai`'s public barrel (migration plan Phase 5, the actual pivot) — `AiServicePort`'s real
 * in-process ADK-TS/OpenRouter implementation (`AiService`), the retrieval/grounding chokepoint
 * (`RetrievalService`), and the `AiUsageRecorderPort` persistence-backed implementation. Nothing
 * outside this module may import `./domain/**`/`./application/**`/`./adk/**`/`./infrastructure/**`
 * directly (enforced by `apps/next/.eslintrc.cjs`'s `ai` module-boundary rule).
 *
 * {@link getAiService} builds a fresh instance per call — it needs the *current request's*
 * tenant-scoped `DataSource` for its `AiCallLogRepository` (mirrors every other tenant-scoped
 * module's composition-root convention, e.g. `getCurriculaService()`; must be called inside
 * `withTenantContext`). {@link getRetrievalService} is a process-wide singleton (mirrors
 * `AiModelResolver`'s own convention) — `VectorStorePort`/`EmbeddingsPort` need no tenant `DataSource`
 * at all (Qdrant/the embeddings endpoint are single shared resources, tenant-filtered by payload, not
 * schema-per-tenant), so a fresh instance per call would be wasted allocation for no benefit.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandRetrievalService: RetrievalService | undefined;
}

/**
 * Composition root for {@link AiServicePort} — selects {@link AiServiceDisabledAdapter} (no
 * `AiCircuitBreaker` ever constructed, no `AiCallLogRepository`/tenant `DataSource` even read) when
 * `AI_ENABLED=false`, or the real {@link AiService} otherwise. Mirrors legacy's own
 * `AiServiceDisabledAdapter` precedent exactly (see that class's own doc comment) — "a stronger
 * guarantee than a runtime `if` inside a single class." Must be called inside `withTenantContext`
 * when AI is enabled (reads the ambient tenant `DataSource` for the usage-accounting sink); safe to
 * call outside any tenant context when `AI_ENABLED=false` (the disabled adapter needs no
 * `DataSource` at all).
 */
export function getAiService(): AiServicePort {
  if (!getEnv().AI_ENABLED) {
    return new AiServiceDisabledAdapter();
  }
  const dataSource = requireTenantDataSource();
  const usageRecorder = new PersistentAiUsageRecorder(new AiCallLogRepository(dataSource));
  return new AiService(usageRecorder);
}

/** Composition root for the shared {@link RetrievalService} singleton. No tenant `DataSource`
 * dependency — every call site passes its own explicit `TenantScope`. */
export function getRetrievalService(): RetrievalService {
  if (!globalThis.__examlandRetrievalService) {
    globalThis.__examlandRetrievalService = new RetrievalService(getQdrantVectorStoreAdapter(), getEmbeddingsPort());
  }
  return globalThis.__examlandRetrievalService;
}
