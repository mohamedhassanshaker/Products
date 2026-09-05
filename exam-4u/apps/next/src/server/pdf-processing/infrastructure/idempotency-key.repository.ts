import type { DataSource, Repository } from 'typeorm';
import { IdempotencyKeyEntity } from '@/server/infrastructure/database';

/** FR-PDF-10's append-idempotency scope name — the only scope this table has a real writer for. */
export const APPEND_IDEMPOTENCY_SCOPE = 'pdf-append';

/**
 * Data access for `idempotency_key`. Deliberately its own tiny repository (never folded into
 * `AppendExamRepository`) — its writes are **not** part of `AppendExamRepository.appendQuestions`'s own
 * transaction (see that repository's doc comment for why: recording "this request was handled" must
 * survive independently of whether the *data* write committed, which is exactly the two-transaction
 * split that makes a genuinely-partial failure (data committed, bookkeeping not yet recorded) safely
 * retryable).
 */
export class IdempotencyKeyRepository {
  private readonly keys: Repository<IdempotencyKeyEntity>;

  constructor(dataSource: DataSource) {
    this.keys = dataSource.getRepository<IdempotencyKeyEntity>('idempotency_key');
  }

  async findOne(scope: string, key: string): Promise<IdempotencyKeyEntity | null> {
    return this.keys.findOne({ where: { scope, key } });
  }

  /**
   * Idempotently records that `(scope, key)` has been handled. Uses `upsert` (`INSERT ... ON DUPLICATE
   * KEY UPDATE`) rather than a plain `insert` — a *retried* call to `AppendExamService.append` after a
   * genuine partial failure (data already committed by a prior attempt, only this bookkeeping row
   * missing/failed) must be able to record this same `(scope, key)` pair again without throwing a
   * duplicate-key error of its own.
   */
  async record(scope: string, key: string, responseHash: string): Promise<void> {
    await this.keys.upsert({ scope, key, responseHash }, ['scope', 'key']);
  }
}
