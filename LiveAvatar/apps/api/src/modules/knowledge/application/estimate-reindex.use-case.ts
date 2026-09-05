import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { resolveChunker } from '../domain/chunking/chunker-registry';
import { KNOWLEDGE_SOURCE_REPOSITORY, type KnowledgeSourceRepositoryPort } from '../domain/ports';
import { cleanText, parseContent } from '../domain/parsing/parse-content';

/**
 * Illustrative, deliberately-round per-chunk cost/duration constants (Phase
 * 12a plan doc "Decisions made this phase" #8) — **not** derived from a real
 * OpenAI price/latency SLA. The response is always rendered with an explicit
 * "Estimate" label by the caller; these numbers must never be presented as a
 * measurement.
 */
const ESTIMATED_USD_PER_CHUNK = 0.000004;
const ESTIMATED_MS_PER_CHUNK = 50;

/**
 * `GET /tenants/:id/knowledge-sources/:sourceId/reindex-estimate` — read-only,
 * no side effects, no embedding call. Re-runs parse+chunk synchronously
 * against the source's *current* config so the estimate reflects any unsaved
 * config edits already persisted, not the source's last-known `chunk_count`.
 */
@Injectable()
export class EstimateReindexUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(KNOWLEDGE_SOURCE_REPOSITORY) private readonly sources: KnowledgeSourceRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param sourceId - Knowledge source id
   */
  async execute(actor: AdminActor, tenantId: string, sourceId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const source = await this.sources.findById(tenantId, sourceId);
    if (!source) {
      throw AppError.notFound('KNOWLEDGE_SOURCE_NOT_FOUND');
    }

    const text = cleanText(parseContent(source.rawContent, source.parser));
    const chunks = resolveChunker(source.chunkingStrategy).chunk(text, {
      chunkSize: source.chunkSize,
      chunkOverlap: source.chunkOverlap,
    });
    const chunkCount = chunks.length;

    return {
      chunk_count: chunkCount,
      estimated_cost_usd: Math.round(chunkCount * ESTIMATED_USD_PER_CHUNK * 1e6) / 1e6,
      estimated_duration_ms: chunkCount * ESTIMATED_MS_PER_CHUNK,
      is_estimate: true as const,
    };
  }
}
