import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `processed_event` table (created by
 * `migrations/tenant/20260815000002-create-reliability-tables.ts`, Phase 1 sub-slice 1c) — ported
 * verbatim from `legacy/api/src/modules/reliability/infrastructure/entities/
 * processed-event.entity.ts`. This table **is** FR-REL-1's idempotency guarantee, not merely a
 * bookkeeping log: `OutboxPublisherService` checks/writes `(consumer, event_id)` around every handler
 * invocation, so re-delivering the same `outbox_message` row to a consumer that already processed it
 * is a guaranteed no-op for that consumer, never a duplicate side effect.
 */
@Entity({ name: 'processed_event' })
export class ProcessedEventEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  consumer!: string;

  @PrimaryColumn({ name: 'event_id', type: 'char', length: 36 })
  eventId!: string;

  @CreateDateColumn({ name: 'processed_at', type: 'datetime', precision: 3 })
  processedAt!: Date;
}
