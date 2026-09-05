import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `outbox_message` table (created by
 * `migrations/tenant/20260815000002-create-reliability-tables.ts`, Phase 1 sub-slice 1c, FR-REL-1) —
 * ported verbatim from `legacy/api/src/modules/reliability/infrastructure/entities/
 * outbox-message.entity.ts`. `payload` is untyped `Record<string, unknown>` at this layer — each
 * `OutboxConsumer.eventTypes`-matched handler owns interpreting its own event's shape.
 */
@Entity({ name: 'outbox_message' })
export class OutboxMessageEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'json' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  /** When this row next becomes eligible for a claim attempt — advances via exponential backoff
   * (`now + min(2^attempts, 300)s`) after a failed delivery attempt. Deliberately never assigned a
   * JS `Date` on insert (see `OutboxRepository.enqueue`'s doc comment) — MySQL's own
   * `DEFAULT CURRENT_TIMESTAMP(3)` populates it server-side so it is always comparable against a
   * later `NOW(3)` in the same server timezone, regardless of the Node process's own local offset. */
  @Column({ name: 'available_at', type: 'datetime', precision: 3 })
  availableAt!: Date;

  /** Set once every matching consumer has successfully handled this event (or there were none to
   * match) — `NULL` means "still pending" (FR-REL-1's at-least-once guarantee: a row is never
   * deleted, only marked processed). */
  @Column({ name: 'processed_at', type: 'datetime', precision: 3, nullable: true })
  processedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'varchar', length: 1000, nullable: true })
  lastError!: string | null;

  /** The claiming worker's identity (`OutboxRepository.claimBatch`'s conditional `UPDATE ... LIMIT`
   * claim) — set together with {@link lockedUntil} so a second worker replica's own claim attempt on
   * the same row fails its `WHERE` clause while the lock is held. */
  @Column({ name: 'locked_by', type: 'varchar', length: 100, nullable: true })
  lockedBy!: string | null;

  @Column({ name: 'locked_until', type: 'datetime', precision: 3, nullable: true })
  lockedUntil!: Date | null;
}
