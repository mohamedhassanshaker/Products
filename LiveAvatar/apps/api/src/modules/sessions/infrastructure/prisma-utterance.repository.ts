import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { UtteranceInput, UtteranceRepositoryPort, UtteranceRow } from '../domain/telemetry-ports';

/**
 * `TranscriptUtterance` persistence (FR-CALL-3, FR-SESS-1). Each item is
 * upserted on the `(session_id, seq)` unique index (LLD §5.9's "batch;
 * upsert on (session_id, seq)") so a re-sent batch (agent retry after a
 * dropped `/internal` response) never creates a duplicate row.
 */
@Injectable()
export class PrismaUtteranceRepository implements UtteranceRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async upsertMany(sessionId: string, tenantId: string, items: UtteranceInput[]): Promise<void> {
    await this.prisma.withBypass(() =>
      Promise.all(
        items.map((item) =>
          this.prisma.db.transcriptUtterance.upsert({
            where: { sessionId_seq: { sessionId, seq: item.seq } },
            create: {
              sessionId,
              tenantId,
              seq: item.seq,
              role: item.role,
              text: item.text,
              startedAt: item.startedAt,
              endedAt: item.endedAt,
            },
            update: {
              role: item.role,
              text: item.text,
              startedAt: item.startedAt,
              endedAt: item.endedAt,
            },
          }),
        ),
      ),
    );
  }

  /** @inheritdoc */
  async listBySession(sessionId: string): Promise<UtteranceRow[]> {
    const rows = await this.prisma.withBypass(() =>
      this.prisma.db.transcriptUtterance.findMany({
        where: { sessionId },
        orderBy: { seq: 'asc' },
      }),
    );
    return rows.map((row) => ({
      seq: row.seq,
      role: row.role,
      text: row.text,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    }));
  }

  /**
   * @inheritdoc
   *
   * Uses an on-the-fly `to_tsvector`/`plainto_tsquery` match rather than a
   * persisted generated `tsvector` column + GIN index (LLD §4.2's
   * `text_tsv`/`transcript_utterance_tsv_idx`): this project has never
   * committed a versioned migration (schema changes have all gone through
   * `prisma db push` in ad-hoc verification sessions, per the Phase 6
   * decision log), so adding a raw-SQL migration step here with no migration
   * mechanism to carry it would be inventing infra this dispatch doesn't own.
   * Functionally equivalent full-text semantics, computed per query instead
   * of from a precomputed index — a disclosed performance trade-off, not a
   * correctness one, flagged for `nexus-deploy`/the architect to revisit once
   * a real migration pipeline exists.
   */
  async searchSessionIds(q: string, tenantId?: string): Promise<string[]> {
    const rows = tenantId
      ? await this.prisma.db.$queryRaw<{ session_id: string }[]>`
            SELECT DISTINCT session_id FROM transcript_utterance
            WHERE text IS NOT NULL
              AND to_tsvector('simple', text) @@ plainto_tsquery('simple', ${q})
              AND tenant_id = ${tenantId}::uuid
          `
      : await this.prisma.db.$queryRaw<{ session_id: string }[]>`
            SELECT DISTINCT session_id FROM transcript_utterance
            WHERE text IS NOT NULL
              AND to_tsvector('simple', text) @@ plainto_tsquery('simple', ${q})
          `;
    return rows.map((row) => row.session_id);
  }

  /**
   * @inheritdoc
   *
   * Two-step raw update (raw SQL is not tenant-guard-intercepted, so no
   * `withBypass` is needed — the guard extension only wraps model-delegate
   * operations, not `$executeRaw`): first flips `Session.transcript_purged`
   * for every session whose tenant's `retain_transcripts_days` has elapsed
   * since `started_at` and isn't already purged, then nulls transcript text
   * for exactly those sessions. Idempotent by construction (the `WHERE
   * transcript_purged = false` guard means a second run touches zero rows).
   */
  async purgeExpired(): Promise<number> {
    const purged = await this.prisma.db.$queryRaw<{ id: string }[]>`
        UPDATE session s
        SET transcript_purged = true
        FROM data_residency_policy p
        WHERE s.tenant_id = p.tenant_id
          AND s.transcript_purged = false
          AND s.started_at < now() - (p.retain_transcripts_days || ' days')::interval
        RETURNING s.id
      `;
    if (purged.length === 0) {
      return 0;
    }
    const ids = purged.map((row) => row.id);
    await this.prisma.db.$executeRaw`
      UPDATE transcript_utterance SET text = NULL
      WHERE session_id = ANY(${ids}::uuid[]) AND text IS NOT NULL
    `;
    return purged.length;
  }
}
