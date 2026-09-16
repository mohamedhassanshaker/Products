/**
 * `OutboxEvents` — §9.1/§9.2. The domain-row write and the `Pending` insert happen
 * together inside `ChunkRepository.createDocumentWithChunks` (one transaction, per the
 * write-ordering invariant); this port is everything that happens *after* that commit:
 * claiming, applying, and the backoff/dead-lettering around failure.
 */

import type {
  OutboxAggregateKind,
  OutboxState,
  OutboxTargetStore,
} from "../domain/knowledge-catalog.js";

export interface OutboxEventRow {
  readonly id: string;
  readonly aggregateKind: OutboxAggregateKind;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly targetStore: OutboxTargetStore;
  readonly payloadJson: string;
  readonly dedupeKey: string;
  readonly state: OutboxState;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly availableAt: Date;
}

export interface NewOutboxEventInput {
  readonly aggregateKind: OutboxAggregateKind;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly targetStore: OutboxTargetStore;
  readonly payloadJson: string;
  readonly dedupeKey: string;
  readonly now: Date;
}

export interface OutboxRepository {
  /**
   * Used only by reconciliation's "missing" repair (§9.3 step 3) — the ingest path's own
   * `OutboxEvent` inserts happen inside `ChunkRepository.createDocumentWithChunks` itself,
   * in the same transaction as the `Chunk` rows, which this method deliberately is not
   * part of. A duplicate `dedupeKey` is treated as "already queued", not an error — the
   * whole point of a stable dedupe key is that re-enqueuing is a safe no-op.
   */
  enqueue(input: NewOutboxEventInput): Promise<void>;

  /**
   * §9.2 step 3's claim query: rows `Pending`/`Failed` with `availableAt <= now`, locked
   * and marked `InFlight`, oldest-available first, up to `limit`.
   */
  claimBatch(limit: number, workerId: string, now: Date): Promise<readonly OutboxEventRow[]>;

  markApplied(id: string, now: Date): Promise<void>;

  /** `availableAt` is pushed out by `2^attemptCount` seconds capped at 1 hour (the caller computes this — see `application/process-knowledge-outbox.ts`); past `maxAttempts` the row becomes `Dead` instead. */
  markFailed(input: {
    readonly id: string;
    readonly error: string;
    readonly nextAvailableAt: Date;
    readonly becameDead: boolean;
  }): Promise<void>;

  /** Reconciliation step 5: `Dead` rows whose aggregate still exists in SQL Server, reset to `Pending` with `attemptCount` cleared. */
  requeueDead(ids: readonly string[], now: Date): Promise<void>;

  listDeadForAggregate(
    aggregateKind: OutboxAggregateKind,
    aggregateId: string,
  ): Promise<readonly OutboxEventRow[]>;
}
