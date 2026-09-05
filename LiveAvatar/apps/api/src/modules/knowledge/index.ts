/** Public API of the knowledge module. */
export { KnowledgeModule } from './knowledge.module';
export { RunKnowledgeIngestionUseCase } from './application/run-knowledge-ingestion.use-case';
export { SearchKnowledgeUseCase } from './application/search-knowledge.use-case';
export { RecordKnowledgeGapUseCase } from './application/record-knowledge-gap.use-case';
export {
  KNOWLEDGE_SOURCE_REPOSITORY,
  EMBEDDING_CLIENT,
  KNOWLEDGE_INGEST_QUEUE_PORT,
  KNOWLEDGE_CHUNK_REPOSITORY,
  KNOWLEDGE_INGEST_QUEUE,
  KNOWLEDGE_GAP_REPOSITORY,
  AI_SERVICE_CLIENT,
} from './domain/ports';
export type {
  KnowledgeSourceRepositoryPort,
  EmbeddingClientPort,
  KnowledgeIngestQueuePort,
  KnowledgeChunkRepositoryPort,
  KnowledgeGapRepositoryPort,
  CreateKnowledgeSourceInput,
  UpdateKnowledgeSourceInput,
  HybridSearchQuery,
  KnowledgeFilterCondition,
  KnowledgeSearchCandidate,
  AiServiceClientPort,
  RetrievePreviewRequest,
  RetrievePreviewResponse,
} from './domain/ports';
export type { KnowledgeSourceRecord, ChunkingStrategy, KnowledgeSourceParser, KnowledgeSourceStatus } from './domain/knowledge-source';
export { computeIsStale } from './domain/knowledge-source';
