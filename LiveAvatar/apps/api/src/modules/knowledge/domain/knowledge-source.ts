/** Real (`plain_text`/`markdown`) vs. present-but-disabled (`pdf`) parser (Phase 12a plan doc #5). */
export type KnowledgeSourceParser = 'plain_text' | 'markdown' | 'pdf';

/** Real (`fixed`) vs. present-but-disabled (`semantic`/`heading_aware`) chunking strategy (BL-071). */
export type ChunkingStrategy = 'fixed' | 'semantic' | 'heading_aware';

/** Lifecycle of a `KnowledgeSource` through the ingestion pipeline. */
export type KnowledgeSourceStatus = 'pending' | 'processing' | 'ready' | 'failed';

/**
 * `KnowledgeSource` aggregate (Phase 12a, BL-044/046) as the application
 * layer sees it — mirrors `apps/api/prisma/schema.prisma`'s `KnowledgeSource`
 * model field-for-field (camelCase; the Prisma model is the authoritative
 * source of column shapes/widths).
 */
export interface KnowledgeSourceRecord {
  id: string;
  tenantId: string;
  name: string;
  sourceType: 'upload';
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  rawContent: Buffer;
  parser: KnowledgeSourceParser;
  chunkingStrategy: ChunkingStrategy;
  chunkSize: number;
  chunkOverlap: number;
  embeddingModel: string;
  embeddingCredentialRef: string | null;
  status: KnowledgeSourceStatus;
  chunkCount: number;
  errorMessage: string | null;
  configUpdatedAt: Date;
  lastIndexedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Staleness (V-9, schema.prisma's `KnowledgeSource` doc comment): true once
 * the source's config has been edited more recently than its last
 * successful index. Deliberately a derived read-time signal, not a stored
 * column, so it can never drift out of sync with the two timestamps it's
 * computed from.
 * @param record - The `configUpdatedAt`/`lastIndexedAt` pair to compare
 */
export function computeIsStale(record: Pick<KnowledgeSourceRecord, 'lastIndexedAt' | 'configUpdatedAt'>): boolean {
  return record.lastIndexedAt == null ? false : record.configUpdatedAt > record.lastIndexedAt;
}
