import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TenantsModule } from '../tenants';
import {
  AI_SERVICE_CLIENT,
  EMBEDDING_CLIENT,
  KNOWLEDGE_CHUNK_REPOSITORY,
  KNOWLEDGE_GAP_REPOSITORY,
  KNOWLEDGE_INGEST_QUEUE,
  KNOWLEDGE_INGEST_QUEUE_PORT,
  KNOWLEDGE_SOURCE_REPOSITORY,
} from './domain/ports';
import { PrismaKnowledgeSourceRepository } from './infrastructure/prisma-knowledge-source.repository';
import { PrismaKnowledgeChunkRepository } from './infrastructure/prisma-knowledge-chunk.repository';
import { PrismaKnowledgeGapRepository } from './infrastructure/prisma-knowledge-gap.repository';
import { EmbeddingHttpClient } from './infrastructure/embedding-http-client';
import { AiServiceHttpClient } from './infrastructure/ai-service-http-client';
import { KnowledgeIngestQueueProducer } from './infrastructure/knowledge-ingest-queue.producer';
import { CreateKnowledgeSourceUseCase } from './application/create-knowledge-source.use-case';
import { ListKnowledgeSourcesUseCase } from './application/list-knowledge-sources.use-case';
import { GetKnowledgeSourceUseCase } from './application/get-knowledge-source.use-case';
import { UpdateKnowledgeSourceUseCase } from './application/update-knowledge-source.use-case';
import { DeleteKnowledgeSourceUseCase } from './application/delete-knowledge-source.use-case';
import { EstimateReindexUseCase } from './application/estimate-reindex.use-case';
import { TriggerReindexUseCase } from './application/trigger-reindex.use-case';
import { RunKnowledgeIngestionUseCase } from './application/run-knowledge-ingestion.use-case';
import { SearchKnowledgeUseCase } from './application/search-knowledge.use-case';
import { RecordKnowledgeGapUseCase } from './application/record-knowledge-gap.use-case';
import { KnowledgeSourcesController } from './interface/knowledge-sources.controller';

/**
 * `KnowledgeSource`/RAG-ingestion bounded context (Phase 12a, BL-044/046),
 * mirroring `ToolsModule`'s shape layer-for-layer. Registers the
 * `knowledge-ingest` queue itself (`BullModule.registerQueue`) rather than
 * importing `JobsModule` — `JobsModule` depends on domain modules, never the
 * reverse (same convention as `ProvidersModule`/`SessionsModule` etc.). The
 * shared Redis connection config is provided app-wide by `JobsModule`'s own
 * `BullModule.forRootAsync(...)` (a `{ global: true }` dynamic module per
 * `@nestjs/bullmq`'s own source), so no second `forRootAsync` call is needed
 * here — verified against a real local Redis, see
 * `docs/plans/agent-builder-v2-plan.md` Phase 12a result notes.
 */
@Module({
  imports: [TenantsModule, BullModule.registerQueue({ name: KNOWLEDGE_INGEST_QUEUE })],
  controllers: [KnowledgeSourcesController],
  providers: [
    PrismaKnowledgeSourceRepository,
    { provide: KNOWLEDGE_SOURCE_REPOSITORY, useExisting: PrismaKnowledgeSourceRepository },
    PrismaKnowledgeChunkRepository,
    { provide: KNOWLEDGE_CHUNK_REPOSITORY, useExisting: PrismaKnowledgeChunkRepository },
    EmbeddingHttpClient,
    { provide: EMBEDDING_CLIENT, useExisting: EmbeddingHttpClient },
    AiServiceHttpClient,
    { provide: AI_SERVICE_CLIENT, useExisting: AiServiceHttpClient },
    PrismaKnowledgeGapRepository,
    { provide: KNOWLEDGE_GAP_REPOSITORY, useExisting: PrismaKnowledgeGapRepository },
    KnowledgeIngestQueueProducer,
    { provide: KNOWLEDGE_INGEST_QUEUE_PORT, useExisting: KnowledgeIngestQueueProducer },
    CreateKnowledgeSourceUseCase,
    ListKnowledgeSourcesUseCase,
    GetKnowledgeSourceUseCase,
    UpdateKnowledgeSourceUseCase,
    DeleteKnowledgeSourceUseCase,
    EstimateReindexUseCase,
    TriggerReindexUseCase,
    RunKnowledgeIngestionUseCase,
    SearchKnowledgeUseCase,
    RecordKnowledgeGapUseCase,
  ],
  // RunKnowledgeIngestionUseCase is exported so JobsModule's
  // KnowledgeIngestProcessor can call it without this module importing
  // JobsModule. KNOWLEDGE_CHUNK_REPOSITORY/AI_SERVICE_CLIENT are exported
  // for `deployment-config`'s `RunRetrievalPlaygroundUseCase` (Phase 12b —
  // see that file's own doc comment for why it lives there, not here).
  exports: [
    KNOWLEDGE_SOURCE_REPOSITORY,
    KNOWLEDGE_CHUNK_REPOSITORY,
    EMBEDDING_CLIENT,
    AI_SERVICE_CLIENT,
    KNOWLEDGE_INGEST_QUEUE_PORT,
    RunKnowledgeIngestionUseCase,
    // Injected directly by InternalModule's KnowledgeInternalController.
    SearchKnowledgeUseCase,
    RecordKnowledgeGapUseCase,
  ],
})
export class KnowledgeModule {}
