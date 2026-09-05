import { Inject, Injectable } from '@nestjs/common';
import type { CreateKnowledgeSourceRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import {
  KNOWLEDGE_INGEST_QUEUE_PORT,
  KNOWLEDGE_SOURCE_REPOSITORY,
  type KnowledgeIngestQueuePort,
  type KnowledgeSourceRepositoryPort,
} from '../domain/ports';
import {
  assertChunkOverlapValid,
  assertChunkingStrategySupported,
  assertEmbeddingModelSupported,
  assertParserSupported,
  assertSourceName,
  assertUploadFile,
  type UploadedFile,
} from '../domain/validation';
import { toKnowledgeSourceDto } from './knowledge-source-dto';

/** `POST /tenants/:id/knowledge-sources` (Phase 12a, BL-044/046). */
@Injectable()
export class CreateKnowledgeSourceUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(KNOWLEDGE_SOURCE_REPOSITORY) private readonly sources: KnowledgeSourceRepositoryPort,
    @Inject(KNOWLEDGE_INGEST_QUEUE_PORT) private readonly queue: KnowledgeIngestQueuePort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param fields - Non-file multipart body fields
   * @param file - The uploaded file part (multer memory storage)
   */
  async execute(actor: AdminActor, tenantId: string, fields: CreateKnowledgeSourceRequest, file: UploadedFile | undefined) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }

    const validFile = assertUploadFile(file);
    const name = assertSourceName(fields.name);
    const parser = fields.parser ?? 'plain_text';
    const chunkingStrategy = fields.chunking_strategy ?? 'fixed';
    const chunkSize = fields.chunk_size ?? 800;
    const chunkOverlap = fields.chunk_overlap ?? 100;
    const embeddingModel = fields.embedding_model ?? 'text-embedding-3-small';

    assertParserSupported(parser);
    assertChunkingStrategySupported(chunkingStrategy);
    assertEmbeddingModelSupported(embeddingModel);
    assertChunkOverlapValid(chunkSize, chunkOverlap);

    const created = await this.sources.create({
      tenantId,
      name,
      originalFilename: validFile.originalname,
      mimeType: validFile.mimetype,
      fileSizeBytes: validFile.size,
      rawContent: validFile.buffer,
      parser,
      chunkingStrategy,
      chunkSize,
      chunkOverlap,
      embeddingModel,
      embeddingCredentialRef: fields.embedding_credential_ref ?? null,
      status: 'pending',
      chunkCount: 0,
      createdBy: actor.id,
    });

    // Auto-ingest on upload — the create flow itself is the first index, not
    // a "re-index" cost decision requiring the estimate/confirm dance below.
    await this.queue.enqueue({ tenantId, sourceId: created.id });

    return toKnowledgeSourceDto(created);
  }
}
