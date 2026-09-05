import { randomUUID } from 'node:crypto';
import { IsNull, type DataSource, type EntityManager, type Repository } from 'typeorm';
import { OutboxMessageEntity, ProcessedEventEntity } from '@/server/infrastructure/database';
import type { ClaimedOutboxMessage } from '../domain/outbox-consumer.types';

/** The lock duration a single `claimBatch` call reserves a row for (HLD §10.1: "`locked_until =
 * NOW()+30s`") — generous enough for a batch of 50 messages' worth of consumer dispatch, short
 * enough that a crashed publisher's claim expires and becomes reclaimable well within one tick of a
 * healthy replica. Ported verbatim from legacy. */
const LOCK_DURATION_SECONDS = 30;
/** LLD §9.8: "after 10 attempts the row is left unprocessed... surfaced on `/api/metrics`
 * (`outbox_dead_letters`)." */
const MAX_ATTEMPTS_BEFORE_DEAD_LETTER = 10;
/** LLD §9.8: `available_at = now + min(2^attempts, 300)s`. */
const MAX_BACKOFF_SECONDS = 300;

/**
 * Data access for `outbox_message`/`processed_event` — ported logic (not code) from
 * `legacy/api/src/modules/reliability/infrastructure/repositories/outbox.repository.ts`'s
 * `OutboxRepository`, adapted from a `TenantContextService`-backed NestJS provider to a plain class
 * constructed with an already-resolved tenant `DataSource` (this app's established repository
 * convention — see `server/auth/infrastructure/user.repository.ts`'s identical doc comment for why).
 *
 * **Deliberate scope reduction vs. legacy (documented, not silently dropped)**: {@link enqueue} does
 * **not** upsert `platform.tenant_work_hint` — that table/the hinted-sweep optimization it powers
 * (HLD §10.2) is out of this dispatch's scope (see `server/reliability/index.ts`'s own doc comment).
 * This makes `enqueue` strictly simpler than legacy's: it needs no ambient tenant-id/request-context
 * at all, only the caller's own (possibly transactional) `EntityManager`.
 */
export class OutboxRepository {
  constructor(private readonly dataSource: DataSource) {}

  private manager(): EntityManager {
    return this.dataSource.manager;
  }

  private repo(em: EntityManager = this.manager()): Repository<OutboxMessageEntity> {
    // Looked up by the literal table-name string, not the entity class reference — see
    // `server/tenancy/raw-tenant-lookup.ts`'s doc comment (cross-webpack-bundle entity-class-identity
    // mismatch under production minification).
    return em.getRepository<OutboxMessageEntity>('outbox_message');
  }

  /**
   * FR-REL-1's transactional-outbox write: **must** be called with the caller's own transactional
   * `EntityManager` whenever this event must commit atomically with whatever business change is
   * publishing it (e.g. `UserAdminRepository.insert`'s `user.created` event) — a downstream consumer
   * failure can then never roll back the primary action, and a primary-action rollback can never
   * leave an orphaned event behind either. Callers that have no such requirement may pass
   * `dataSource.manager` directly.
   *
   * `available_at` is deliberately left unset on the entity instance (never assigned a JS `Date`) —
   * ported verbatim workaround from legacy: none of this codebase's `DataSource` connections pin an
   * explicit `timezone` option, so a JS `Date` bound as a parameter is serialized using the *host
   * process's* local offset, while `NOW(3)` inside MySQL reads the server's own (typically UTC)
   * clock — leaving the column unset lets MySQL's own `DEFAULT CURRENT_TIMESTAMP(3)` populate it
   * server-side instead, keeping it always comparable against a later `NOW(3)` in `claimBatch`.
   */
  async enqueue(em: EntityManager, eventType: string, payload: Record<string, unknown>): Promise<string> {
    const id = randomUUID();
    const repo = this.repo(em);
    const message = repo.create({
      id,
      eventType,
      payload,
      processedAt: null,
      attempts: 0,
      lastError: null,
      lockedBy: null,
      lockedUntil: null,
    });
    await repo.save(message);
    return id;
  }

  /**
   * HLD §10.1's conditional-update claim, batched: `UPDATE ... LIMIT ?` first (an atomic, row-level
   * claim — two concurrent callers racing the same rows can never both win the same row), then a
   * `SELECT ... WHERE locked_by = ?` to read back exactly the rows *this* call won.
   */
  async claimBatch(workerId: string, limit: number): Promise<ClaimedOutboxMessage[]> {
    await this.manager().query(
      `UPDATE outbox_message
       SET locked_by = ?, locked_until = DATE_ADD(NOW(3), INTERVAL ${LOCK_DURATION_SECONDS} SECOND)
       WHERE processed_at IS NULL
         AND available_at <= NOW(3)
         AND (locked_until IS NULL OR locked_until < NOW(3))
       LIMIT ?`,
      [workerId, limit],
    );

    const rows = await this.repo().find({ where: { lockedBy: workerId, processedAt: IsNull() } });
    return rows.map((r) => ({ id: r.id, eventType: r.eventType, payload: r.payload, attempts: r.attempts }));
  }

  /** Whether `consumer` has already durably processed `eventId` (FR-REL-1's idempotency guard). */
  async hasProcessed(consumer: string, eventId: string): Promise<boolean> {
    const row = await this.manager().getRepository<ProcessedEventEntity>('processed_event').findOne({ where: { consumer, eventId } });
    return row !== null;
  }

  /** Records that `consumer` has now handled `eventId` — a duplicate insert (two racing publisher
   * passes somehow both got this far, which the row-level lock above should already prevent) is
   * swallowed as "already recorded," never surfaced as an error. */
  async markProcessedByConsumer(consumer: string, eventId: string): Promise<void> {
    try {
      await this.manager().getRepository<ProcessedEventEntity>('processed_event').insert({ consumer, eventId, processedAt: new Date() });
    } catch {
      // Duplicate-key = already marked by a previous attempt at this same event/consumer pair.
    }
  }

  /** Marks `id` fully delivered (every matching consumer succeeded) and releases its lock.
   * `processed_at` is set via server-side `NOW(3)` (raw SQL), matching `enqueue`'s uniform
   * "server-authoritative timestamp" convention. */
  async markMessageProcessed(id: string): Promise<void> {
    await this.manager().query(
      `UPDATE outbox_message SET processed_at = NOW(3), locked_by = NULL, locked_until = NULL WHERE id = ?`,
      [id],
    );
  }

  /**
   * Records a failed delivery attempt and releases the lock so a later tick may retry — never marks
   * `processed_at`. `attempts` increments; `available_at` backs off exponentially
   * (`min(2^attempts, 300)s`). Attempts at/above {@link MAX_ATTEMPTS_BEFORE_DEAD_LETTER} are left
   * exactly where they are (still unprocessed, `last_error` retained) rather than deleted — a
   * human-visible dead letter, not silently dropped work.
   */
  async recordFailure(id: string, attemptsSoFar: number, lastError: string): Promise<void> {
    const attempts = attemptsSoFar + 1;
    const backoffSeconds = Math.min(2 ** attempts, MAX_BACKOFF_SECONDS);
    await this.manager().query(
      `UPDATE outbox_message
       SET attempts = ?, last_error = ?, available_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
           locked_by = NULL, locked_until = NULL
       WHERE id = ?`,
      [attempts, lastError.slice(0, 1000), backoffSeconds, id],
    );
  }

  /** True if `MAX_ATTEMPTS_BEFORE_DEAD_LETTER` has been reached — used purely for observability/
   * logging, never to stop retrying automatically. */
  isDeadLetter(attempts: number): boolean {
    return attempts >= MAX_ATTEMPTS_BEFORE_DEAD_LETTER;
  }

  /** Whether any row is still genuinely pending — exposed for tests/future hinted-sweep re-adoption;
   * no current caller needs it (legacy's `runHintedSweep` used it to decide whether to clear a
   * tenant's work hint, which this dispatch doesn't build). */
  async hasPending(): Promise<boolean> {
    const count = await this.repo().count({ where: { processedAt: IsNull() } });
    return count > 0;
  }

  /**
   * Outbox health counts for this tenant's own schema (Phase 2 sub-slice "2d" Reliability dashboard —
   * no legacy precedent; legacy never built an admin-facing reliability viewer). `pending` is every
   * unprocessed row regardless of attempt count; `deadLetter` is the subset of `pending` that has
   * already exhausted {@link MAX_ATTEMPTS_BEFORE_DEAD_LETTER} retries (a genuine subset, not a
   * disjoint count — a dead-letter row is still "pending" in the sense that it has never been marked
   * processed); `delivered` is every row that has been. Raw SQL (not the `Repository.count()`
   * builder) for all three — a single round trip each, and `deadLetter`'s `attempts >=` comparison has
   * no direct `FindOptionsWhere` operator equivalent that reads as clearly.
   */
  async countsByStatus(): Promise<{ pending: number; delivered: number; deadLetter: number }> {
    const rows: { pending: number; delivered: number; dead_letter: number }[] = await this.manager().query(
      `SELECT
         SUM(CASE WHEN processed_at IS NULL THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN processed_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN processed_at IS NULL AND attempts >= ? THEN 1 ELSE 0 END) AS dead_letter
       FROM outbox_message`,
      [MAX_ATTEMPTS_BEFORE_DEAD_LETTER],
    );
    const row = rows[0];
    return {
      pending: Number(row?.pending ?? 0),
      delivered: Number(row?.delivered ?? 0),
      deadLetter: Number(row?.dead_letter ?? 0),
    };
  }
}
