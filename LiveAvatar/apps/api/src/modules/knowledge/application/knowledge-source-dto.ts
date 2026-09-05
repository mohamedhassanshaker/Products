import type { KnowledgeSourceDto } from '@liveavatar/contracts';
import { computeIsStale, type KnowledgeSourceRecord } from '../domain/knowledge-source';

/**
 * Maps a `KnowledgeSource` record to its wire DTO. Deliberately omits
 * `rawContent`/`createdBy` — the DTO never carries file bytes back to the
 * client, and `embedding_credential_ref` only ever carries the ref *name*,
 * never a resolved secret (Nest never resolves it — only the Python service
 * does, from its own credential store).
 */
export function toKnowledgeSourceDto(record: KnowledgeSourceRecord): KnowledgeSourceDto {
  return {
    id: record.id,
    tenant_id: record.tenantId,
    name: record.name,
    source_type: record.sourceType,
    original_filename: record.originalFilename,
    mime_type: record.mimeType,
    file_size_bytes: record.fileSizeBytes,
    parser: record.parser,
    chunking_strategy: record.chunkingStrategy,
    chunk_size: record.chunkSize,
    chunk_overlap: record.chunkOverlap,
    embedding_model: record.embeddingModel,
    embedding_credential_ref: record.embeddingCredentialRef,
    status: record.status,
    chunk_count: record.chunkCount,
    error_message: record.errorMessage,
    is_stale: computeIsStale(record),
    config_updated_at: record.configUpdatedAt.toISOString(),
    last_indexed_at: record.lastIndexedAt ? record.lastIndexedAt.toISOString() : null,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}
