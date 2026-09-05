import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ChunkingStrategy, KnowledgeSourceParser, KnowledgeSourceRecord, KnowledgeSourceStatus } from '../domain/knowledge-source';
import type {
  CreateKnowledgeSourceInput,
  KnowledgeSourceRepositoryPort,
  UpdateKnowledgeSourceInput,
} from '../domain/ports';

/** Prisma row shape for `KnowledgeSource`. */
type Row = {
  id: string;
  tenantId: string;
  name: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  rawContent: Uint8Array;
  parser: string;
  chunkingStrategy: string;
  chunkSize: number;
  chunkOverlap: number;
  embeddingModel: string;
  embeddingCredentialRef: string | null;
  status: string;
  chunkCount: number;
  errorMessage: string | null;
  configUpdatedAt: Date;
  lastIndexedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * `KnowledgeSource` persistence (Phase 12a, BL-044/046). Every query is
 * explicitly `tenantId`-filtered, mirroring `PrismaToolDefinitionRepository`'s
 * tenant-scoping and optimistic-concurrency `update` pattern exactly.
 */
@Injectable()
export class PrismaKnowledgeSourceRepository implements KnowledgeSourceRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async create(input: CreateKnowledgeSourceInput): Promise<KnowledgeSourceRecord> {
    const row = await this.prisma.db.knowledgeSource.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        fileSizeBytes: input.fileSizeBytes,
        // `Buffer`'s type parameter is `ArrayBufferLike` (includes
        // `SharedArrayBuffer`), while the generated Prisma client's `Bytes`
        // field expects `Uint8Array<ArrayBuffer>` specifically — a TS
        // generics-strictness mismatch only; a `Buffer` genuinely *is* a
        // `Uint8Array` at runtime, so this is not a real type-safety gap.
        rawContent: input.rawContent as never,
        parser: input.parser,
        chunkingStrategy: input.chunkingStrategy,
        chunkSize: input.chunkSize,
        chunkOverlap: input.chunkOverlap,
        embeddingModel: input.embeddingModel,
        embeddingCredentialRef: input.embeddingCredentialRef,
        status: input.status,
        chunkCount: input.chunkCount,
        createdBy: input.createdBy,
      },
    });
    return this.toRecord(row);
  }

  /** @inheritdoc */
  async findById(tenantId: string, id: string): Promise<KnowledgeSourceRecord | null> {
    const row = await this.prisma.db.knowledgeSource.findFirst({ where: { id, tenantId } });
    return row ? this.toRecord(row) : null;
  }

  /** @inheritdoc */
  async findMany(tenantId: string): Promise<KnowledgeSourceRecord[]> {
    const rows = await this.prisma.db.knowledgeSource.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row: Row) => this.toRecord(row));
  }

  /** @inheritdoc */
  async update(
    tenantId: string,
    id: string,
    ifMatch: Date,
    patch: UpdateKnowledgeSourceInput,
  ): Promise<KnowledgeSourceRecord | 'conflict' | 'missing'> {
    const existing = await this.prisma.db.knowledgeSource.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return 'missing';
    }
    const result = await this.prisma.db.knowledgeSource.updateMany({
      where: { id, tenantId, updatedAt: ifMatch },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.parser !== undefined ? { parser: patch.parser } : {}),
        ...(patch.chunkingStrategy !== undefined ? { chunkingStrategy: patch.chunkingStrategy } : {}),
        ...(patch.chunkSize !== undefined ? { chunkSize: patch.chunkSize } : {}),
        ...(patch.chunkOverlap !== undefined ? { chunkOverlap: patch.chunkOverlap } : {}),
        ...(patch.embeddingModel !== undefined ? { embeddingModel: patch.embeddingModel } : {}),
        ...(patch.embeddingCredentialRef !== undefined ? { embeddingCredentialRef: patch.embeddingCredentialRef } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.chunkCount !== undefined ? { chunkCount: patch.chunkCount } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        ...(patch.configUpdatedAt !== undefined ? { configUpdatedAt: patch.configUpdatedAt } : {}),
        ...(patch.lastIndexedAt !== undefined ? { lastIndexedAt: patch.lastIndexedAt } : {}),
      },
    });
    if (result.count === 0) {
      return 'conflict';
    }
    const updated = await this.prisma.db.knowledgeSource.findFirst({ where: { id, tenantId } });
    return updated ? this.toRecord(updated) : 'missing';
  }

  /** @inheritdoc */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.prisma.db.knowledgeSource.deleteMany({ where: { id, tenantId } });
    return result.count > 0;
  }

  private toRecord(row: Row): KnowledgeSourceRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      sourceType: 'upload',
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      fileSizeBytes: row.fileSizeBytes,
      rawContent: Buffer.from(row.rawContent),
      parser: row.parser as KnowledgeSourceParser,
      chunkingStrategy: row.chunkingStrategy as ChunkingStrategy,
      chunkSize: row.chunkSize,
      chunkOverlap: row.chunkOverlap,
      embeddingModel: row.embeddingModel,
      embeddingCredentialRef: row.embeddingCredentialRef,
      status: row.status as KnowledgeSourceStatus,
      chunkCount: row.chunkCount,
      errorMessage: row.errorMessage,
      configUpdatedAt: row.configUpdatedAt,
      lastIndexedAt: row.lastIndexedAt,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
