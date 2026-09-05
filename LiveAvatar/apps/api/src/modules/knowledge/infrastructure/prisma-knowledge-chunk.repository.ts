import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  HybridSearchQuery,
  KnowledgeChunkInput,
  KnowledgeChunkRecord,
  KnowledgeChunkRepositoryPort,
  KnowledgeSearchCandidate,
} from '../domain/ports';

/** One raw row shape `hybridSearch`'s query returns, before mapping to `KnowledgeSearchCandidate`. */
interface HybridSearchRow {
  chunk_id: string;
  source_id: string;
  source_name: string;
  text: string;
  vector_score: number;
  keyword_score: number;
  passed_filter: boolean;
}

/**
 * `KnowledgeChunk` persistence, including the pgvector embedding write
 * (Phase 12a, BL-044/046). `replaceForSource` mirrors this codebase's
 * `PrismaService.transaction(...)` helper (see `prisma.service.ts`) rather
 * than inventing a new transaction mechanism. `writeEmbeddings` mirrors
 * `prisma-utterance.repository.ts`'s documented raw-SQL escape hatch:
 * `$executeRaw`'s tagged template binds every value (including the vector
 * literal) as a parameter — never string-concatenated into the SQL text —
 * and the `tenant_id`/`source_id` predicates are included by hand because
 * raw SQL bypasses the Prisma tenantGuard extension entirely.
 */
@Injectable()
export class PrismaKnowledgeChunkRepository implements KnowledgeChunkRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async replaceForSource(tenantId: string, sourceId: string, chunks: KnowledgeChunkInput[]): Promise<KnowledgeChunkRecord[]> {
    return this.prisma.transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({ where: { tenantId, sourceId } });
      if (chunks.length === 0) {
        return [];
      }
      await tx.knowledgeChunk.createMany({
        data: chunks.map((chunk) => ({
          tenantId,
          sourceId,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
        })),
      });
      const rows = await tx.knowledgeChunk.findMany({
        where: { tenantId, sourceId },
        orderBy: { chunkIndex: 'asc' },
      });
      return rows.map((row) => ({ id: row.id, chunkIndex: row.chunkIndex, text: row.text, tokenCount: row.tokenCount }));
    });
  }

  /** @inheritdoc */
  async writeEmbeddings(tenantId: string, sourceId: string, items: { chunkId: string; embedding: number[] }[]): Promise<void> {
    for (const item of items) {
      if (item.embedding.length === 0 || !item.embedding.every((value) => Number.isFinite(value))) {
        throw new Error('embedding must be a non-empty array of finite numbers');
      }
    }
    for (const item of items) {
      // Built only from validated finite numbers above — never from
      // arbitrary user input — before being passed as a single bound
      // parameter of the tagged template below.
      const literal = `[${item.embedding.join(',')}]`;
      await this.prisma.db.$executeRaw`
        UPDATE knowledge_chunk
        SET embedding = ${literal}::vector
        WHERE id = ${item.chunkId}::uuid AND tenant_id = ${tenantId}::uuid AND source_id = ${sourceId}::uuid
      `;
    }
  }

  /**
   * @inheritdoc
   *
   * **Security note (this phase's named highest injection-risk surface)**:
   * every value below — including `query.filter.field`/`query.filter.value`
   * — is bound as a tagged-template parameter, never string-concatenated.
   * `filter.field` binds safely as `metadata ->> $n` because Postgres's
   * `jsonb ->> text` operator's right-hand side is an ordinary text
   * *expression*, not a SQL identifier (unlike a column/table name) — it can
   * be a bind parameter the same as any other value, so no
   * `Prisma.raw`/identifier-escaping is needed here at all (contrast this
   * with, say, a dynamic `ORDER BY column_name`, which genuinely cannot be
   * parameterized and would need allow-listing). `filter.field` is still
   * pattern-constrained at the contract layer (`^[a-zA-Z0-9_]+$`,
   * `KnowledgeSearchFilterConditionSchema`) as input hygiene, not because
   * this query needs it for safety.
   *
   * The filter's four `CASE` branches are always all present in the query
   * text (never conditionally assembled from user input) — which branch
   * actually applies is decided by comparing the bound `$filterOp`/
   * `$filterEnabled` values, not by changing the SQL itself. `passed_filter`
   * is computed in the same query (no second round trip) so a disabled/
   * absent filter's `true` default and an enabled filter's real comparison
   * share one code path.
   */
  async hybridSearch(query: HybridSearchQuery): Promise<KnowledgeSearchCandidate[]> {
    if (query.sourceRefs.length === 0) {
      return [];
    }
    // Built only from a caller-supplied array of finite numbers (Python's
    // resolved query embedding) — never from arbitrary user input — before
    // being passed as a single bound parameter, same discipline
    // `writeEmbeddings` above already applies.
    if (query.queryEmbedding.length === 0 || !query.queryEmbedding.every((v) => Number.isFinite(v))) {
      throw new Error('queryEmbedding must be a non-empty array of finite numbers');
    }
    const embeddingLiteral = `[${query.queryEmbedding.join(',')}]`;
    const filterEnabled = Boolean(query.filter);
    const filterField = query.filter?.field ?? '';
    const filterOp = query.filter?.op ?? 'eq';
    const filterValue = query.filter?.value ?? '';

    // The blend expression is computed in a subquery first, then referenced
    // by (real, projected) column name in the outer ORDER BY — Postgres
    // resolves an identifier inside a compound ORDER BY expression against
    // real table/subquery columns, not the enclosing SELECT list's own
    // aliases (that shortcut only works for a *bare* `ORDER BY alias`, not
    // `ORDER BY (weight * alias + ...)`). Confirmed the hard way: an earlier
    // version of this query referenced `vector_score`/`keyword_score`
    // directly in a compound `ORDER BY` expression and failed with a real
    // `column "vector_score" does not exist` error the first time it ran
    // against a live Postgres — caught by this phase's own "verify hybrid
    // search for real" gate step, not by any mocked unit test (which cannot
    // catch a raw-SQL identifier-resolution bug).
    const rows = await this.prisma.db.$queryRaw<HybridSearchRow[]>`
      SELECT * FROM (
        SELECT
          kc.id AS chunk_id,
          kc.source_id,
          ks.name AS source_name,
          kc.text,
          GREATEST(0, LEAST(1, 1 - (kc.embedding <=> ${embeddingLiteral}::vector))) AS vector_score,
          ts_rank(kc.search_vector, plainto_tsquery('simple', ${query.queryText}), 32) AS keyword_score,
          CASE
            WHEN ${filterEnabled} = false THEN true
            WHEN ${filterOp} = 'eq' THEN (kc.metadata ->> ${filterField}) = ${filterValue}
            WHEN ${filterOp} = 'neq' THEN (kc.metadata ->> ${filterField}) IS DISTINCT FROM ${filterValue}
            WHEN ${filterOp} = 'contains' THEN (kc.metadata ->> ${filterField}) ILIKE ('%' || ${filterValue} || '%')
            ELSE true
          END AS passed_filter
        FROM knowledge_chunk kc
        JOIN knowledge_source ks ON ks.id = kc.source_id
        WHERE kc.tenant_id = ${query.tenantId}::uuid
          AND kc.source_id = ANY(${query.sourceRefs}::uuid[])
          AND kc.embedding IS NOT NULL
      ) candidates
      ORDER BY (${query.vectorWeight} * vector_score + ${query.keywordWeight} * keyword_score) DESC
      LIMIT ${query.candidates}
    `;

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      sourceId: row.source_id,
      sourceName: row.source_name,
      text: row.text,
      vectorScore: row.vector_score,
      keywordScore: row.keyword_score,
      blendScore: query.vectorWeight * row.vector_score + query.keywordWeight * row.keyword_score,
      passedFilter: row.passed_filter,
    }));
  }
}
