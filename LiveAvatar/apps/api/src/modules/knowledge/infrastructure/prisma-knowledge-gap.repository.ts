import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { KnowledgeGapInput, KnowledgeGapRepositoryPort } from '../domain/ports';

/**
 * `KnowledgeGap` persistence (Phase 12b, BL-045/047, R-R7) — the 12a table's
 * first writer. A plain Prisma model insert (no raw-SQL escape hatch
 * needed here, unlike `PrismaKnowledgeChunkRepository` — this table has no
 * pgvector/tsvector column).
 */
@Injectable()
export class PrismaKnowledgeGapRepository implements KnowledgeGapRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async record(input: KnowledgeGapInput): Promise<void> {
    await this.prisma.db.knowledgeGap.create({
      data: {
        tenantId: input.tenantId,
        sourceId: input.sourceId,
        query: input.query,
        bestScore: input.bestScore,
      },
    });
  }
}
