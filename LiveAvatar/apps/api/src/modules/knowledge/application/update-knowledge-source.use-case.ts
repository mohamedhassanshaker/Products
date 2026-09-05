import { Inject, Injectable } from '@nestjs/common';
import type { UpdateKnowledgeSourceRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import {
  KNOWLEDGE_SOURCE_REPOSITORY,
  type KnowledgeSourceRepositoryPort,
  type UpdateKnowledgeSourceInput,
} from '../domain/ports';
import {
  assertChunkOverlapValid,
  assertChunkingStrategySupported,
  assertEmbeddingModelSupported,
  assertParserSupported,
  assertSourceName,
} from '../domain/validation';
import { toKnowledgeSourceDto } from './knowledge-source-dto';

/**
 * `PATCH /tenants/:id/knowledge-sources/:sourceId`. Deliberately does **not**
 * enqueue a re-index (R-R2) — a config edit alone must not silently start a
 * costly job; the operator sees the cost/duration estimate and confirms via
 * `EstimateReindexUseCase`/`TriggerReindexUseCase` separately. Bumping
 * `configUpdatedAt` here is what makes a source stale (V-9) relative to its
 * `lastIndexedAt` once any of `parser`/`chunking_strategy`/`chunk_size`/
 * `chunk_overlap`/`embedding_model`/`embedding_credential_ref` changes —
 * `name` alone does not affect indexing, so it does not bump it.
 */
@Injectable()
export class UpdateKnowledgeSourceUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(KNOWLEDGE_SOURCE_REPOSITORY) private readonly sources: KnowledgeSourceRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param sourceId - Knowledge source id
   * @param input - Partial fields
   * @param ifMatch - Required `If-Match` header value (ISO `updated_at`)
   */
  async execute(
    actor: AdminActor,
    tenantId: string,
    sourceId: string,
    input: UpdateKnowledgeSourceRequest,
    ifMatch: string,
  ) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const existing = await this.sources.findById(tenantId, sourceId);
    if (!existing) {
      throw AppError.notFound('KNOWLEDGE_SOURCE_NOT_FOUND');
    }

    const patch: UpdateKnowledgeSourceInput = {};
    let configFieldChanged = false;

    if (input.name !== undefined) {
      patch.name = assertSourceName(input.name);
    }
    if (input.parser !== undefined) {
      assertParserSupported(input.parser);
      patch.parser = input.parser;
      configFieldChanged = true;
    }
    if (input.chunking_strategy !== undefined) {
      assertChunkingStrategySupported(input.chunking_strategy);
      patch.chunkingStrategy = input.chunking_strategy;
      configFieldChanged = true;
    }
    if (input.embedding_model !== undefined) {
      assertEmbeddingModelSupported(input.embedding_model);
      patch.embeddingModel = input.embedding_model;
      configFieldChanged = true;
    }
    if (input.chunk_size !== undefined) {
      patch.chunkSize = input.chunk_size;
      configFieldChanged = true;
    }
    if (input.chunk_overlap !== undefined) {
      patch.chunkOverlap = input.chunk_overlap;
      configFieldChanged = true;
    }
    if (input.embedding_credential_ref !== undefined) {
      patch.embeddingCredentialRef = input.embedding_credential_ref;
      configFieldChanged = true;
    }

    const resultingChunkSize = patch.chunkSize ?? existing.chunkSize;
    const resultingChunkOverlap = patch.chunkOverlap ?? existing.chunkOverlap;
    assertChunkOverlapValid(resultingChunkSize, resultingChunkOverlap);

    if (configFieldChanged) {
      patch.configUpdatedAt = new Date();
    }

    const ifMatchDate = new Date(ifMatch);
    if (Number.isNaN(ifMatchDate.getTime())) {
      throw AppError.conflict('CONFIG_CONFLICT');
    }

    const result = await this.sources.update(tenantId, sourceId, ifMatchDate, patch);
    if (result === 'missing') {
      throw AppError.notFound('KNOWLEDGE_SOURCE_NOT_FOUND');
    }
    if (result === 'conflict') {
      throw AppError.conflict('CONFIG_CONFLICT');
    }
    return toKnowledgeSourceDto(result);
  }
}
