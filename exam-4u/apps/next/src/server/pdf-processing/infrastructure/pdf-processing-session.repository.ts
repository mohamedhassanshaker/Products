import type { DataSource, Repository } from 'typeorm';
import { PdfProcessingSessionEntity, GeneratedQuestionEntity } from '@/server/infrastructure/database';

/** Statuses `StaleSessionRecoveryWorker` considers "in-flight" — a session in any other status
 * (`Pending`, `Completed`, `Failed`) is either not yet started or already resolved, so a stale
 * heartbeat on those is meaningless. */
const IN_FLIGHT_STATUSES: PdfProcessingSessionEntity['status'][] = ['Extracting', 'Classifying', 'Processing'];

/**
 * Data access for `pdf_processing_session` (migration plan Phase 6, sub-slice "6a") — ported logic
 * from `legacy/api/src/modules/pdf-processing/infrastructure/repositories/
 * pdf-processing-session.repository.ts`, adapted to this app's plain-class composition convention (no
 * NestJS DI, no `TenantContextService` — constructed directly with the current tenant `DataSource`,
 * matching `ExamAuthoringRepository`'s identical shape). Every lookup uses the literal table-name
 * string form (`getRepository<Entity>('table_name')`), never the entity class, per this app's
 * cross-webpack-bundle TypeORM fix (`docs/plans/nextjs-rewrite-phase1-plan.md`'s "Decisions made" #3).
 */
export class PdfProcessingSessionRepository {
  private readonly sessions: Repository<PdfProcessingSessionEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.sessions = dataSource.getRepository<PdfProcessingSessionEntity>('pdf_processing_session');
  }

  async insert(entity: PdfProcessingSessionEntity): Promise<PdfProcessingSessionEntity> {
    await this.sessions.insert(entity);
    return entity;
  }

  async findById(id: string): Promise<PdfProcessingSessionEntity | null> {
    return this.sessions.findOne({ where: { id } });
  }

  /** `GET /api/pdf-processing/sessions`'s list backing — the full, unsorted-by-any-param set (no
   * filter/pagination params exist on this route this sub-slice, matching
   * `ExamAuthoringRepository.findAll`'s identical established scope), newest first. */
  async findAll(): Promise<PdfProcessingSessionEntity[]> {
    return this.sessions.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * FR-PDF-2 tier-1 exact-hash dedup lookup: the most recent successfully-`Completed` session for the
   * same `fileHash`, excluding the session currently being processed (a session can never dedup
   * against itself). `ix_sess_hash_status` (this table's own migration) makes this an index lookup, not
   * a scan.
   */
  async findLatestCompletedByHash(fileHash: string, excludeSessionId: string): Promise<PdfProcessingSessionEntity | null> {
    return this.sessions
      .createQueryBuilder('s')
      .where('s.file_hash = :fileHash', { fileHash })
      .andWhere('s.status = :status', { status: 'Completed' })
      .andWhere('s.id != :excludeSessionId', { excludeSessionId })
      .orderBy('s.created_at', 'DESC')
      .getOne();
  }

  async save(entity: PdfProcessingSessionEntity): Promise<PdfProcessingSessionEntity> {
    return this.sessions.save(entity);
  }

  // ── StaleSessionRecoveryWorker (FR-REL-3, HLD §10.1) ────────────────────────────────────────────

  /**
   * In-flight session ids whose `heartbeat_at` is missing or older than `staleMs` milliseconds ago —
   * the candidate set a sweep pass will attempt to claim. A `SELECT`, not a mutation: claiming happens
   * per-id via {@link claimStale} so two concurrent worker replicas racing the *same* candidate list
   * still only ever let one of them actually win any given row.
   *
   * **Takes `staleMs`, not a precomputed cutoff `Date`, deliberately**: the cutoff is computed *inside*
   * this SQL statement via `NOW(3) - INTERVAL ? MICROSECOND`, never in JS — a JS-computed `Date` bound
   * as a raw parameter would be serialized using the host process's local timezone offset, while
   * `NOW(3)` reads the MySQL server's own clock; computing the cutoff server-side sidesteps the whole
   * class of bug rather than relying on the two clocks agreeing (ported verbatim rationale from
   * legacy's identical method).
   */
  async findStaleCandidateIds(staleMs: number, limit: number): Promise<string[]> {
    const rows = await this.sessions
      .createQueryBuilder('s')
      .select('s.id', 'id')
      .where('s.status IN (:...statuses)', { statuses: IN_FLIGHT_STATUSES })
      .andWhere('(s.heartbeat_at IS NULL OR s.heartbeat_at <= DATE_SUB(NOW(3), INTERVAL :staleMicros MICROSECOND))', {
        staleMicros: staleMs * 1000,
      })
      .limit(limit)
      .getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  /**
   * A conditional-update claim, applied per-row: `UPDATE ... WHERE id=? AND status IN (...) AND
   * (heartbeat_at IS NULL OR heartbeat_at <= NOW(3) - staleMs)`. Returns whether *this* call's `UPDATE`
   * affected exactly one row — the real, database-enforced multi-replica-safety guarantee (two
   * concurrent callers targeting the same session: MySQL's row lock serializes the two `UPDATE`s, and
   * by the time the second one's `WHERE` clause is (re-)evaluated the first has already committed a
   * fresh `heartbeat_at = NOW()`, which no longer satisfies the staleness condition — so the second
   * caller's `affectedRows` is provably `0`, never a double-claim). `staleMs` must be the same
   * threshold {@link findStaleCandidateIds} used to build the candidate list.
   */
  async claimStale(id: string, workerId: string, staleMs: number): Promise<boolean> {
    const result: { affectedRows?: number } = await this.dataSource.query(
      `UPDATE pdf_processing_session
       SET worker_id = ?, heartbeat_at = NOW(3)
       WHERE id = ?
         AND status IN ('Extracting','Classifying','Processing')
         AND (heartbeat_at IS NULL OR heartbeat_at <= DATE_SUB(NOW(3), INTERVAL ? MICROSECOND))`,
      [workerId, id, staleMs * 1000],
    );
    return (result?.affectedRows ?? 0) === 1;
  }

  /**
   * The genuine "full expression" of durably committing a generation batch: **one transaction** inserts
   * this batch's `generated_question` rows AND advances `last_completed_page`/`covered_concepts`/
   * `tokens_used`/`total_cost`/`heartbeat_at` on the owning session row — so a crash between any two
   * batches never re-does or loses a completed one (`ExamExtractionService`'s per-page loop calls this
   * once per page, never accumulating in-memory-only state across the whole loop).
   *
   * `tokens_used`/`total_cost` are advanced via a server-side `col + ?` expression (never a
   * read-then-write from the JS-held `session` object) so a concurrent heartbeat/claim update from a
   * racing recovery attempt can never clobber a partial accumulation — the same "compute server-side,
   * never round-trip through a JS value that might already be stale" discipline {@link findStaleCandidateIds}'s
   * own doc comment documents for timestamps.
   */
  async persistBatchAndAdvanceWatermark(params: {
    sessionId: string;
    entities: GeneratedQuestionEntity[];
    tokensDelta: number;
    costDelta: number;
    endPage: number;
    coveredConcepts: string[];
  }): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      if (params.entities.length > 0) {
        await em.getRepository<GeneratedQuestionEntity>('generated_question').insert(params.entities);
      }
      await em
        .getRepository<PdfProcessingSessionEntity>('pdf_processing_session')
        .createQueryBuilder()
        .update(PdfProcessingSessionEntity)
        .set({
          lastCompletedPage: params.endPage,
          coveredConcepts: params.coveredConcepts,
          tokensUsed: () => `tokens_used + ${Number(params.tokensDelta) || 0}`,
          totalCost: () => `total_cost + ${Number(params.costDelta) || 0}`,
          heartbeatAt: () => 'NOW(3)',
        })
        .where('id = :id', { id: params.sessionId })
        .execute();
    });
  }
}
