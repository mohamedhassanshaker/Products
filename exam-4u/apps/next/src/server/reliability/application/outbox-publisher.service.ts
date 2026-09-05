import type pino from 'pino';
import type { OutboxConsumer, ClaimedOutboxMessage } from '../domain/outbox-consumer.types';
import type { OutboxRepository } from '../infrastructure/outbox.repository';

const OUTBOX_BATCH_SIZE = 50;

/**
 * FR-REL-1's consumer-dispatch logic — ported logic from `legacy/api/src/modules/reliability/
 * application/outbox-publisher.worker.ts`'s `OutboxPublisher`, split from the tenant-iteration/tick-
 * scheduling concerns (legacy's `runHintedSweep`/`runFullSweep`), which live in this dispatch's
 * `server/workers/outbox-publisher.ts` instead (see that file's own doc comment). This class assumes
 * it is already scoped to one tenant — i.e. its `OutboxRepository` was constructed with that
 * tenant's own `DataSource` — and knows nothing about *which* tenant that is or how many others exist.
 */
export class OutboxPublisherService {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly consumers: OutboxConsumer[],
    private readonly logger: pino.Logger,
  ) {}

  /**
   * Claims and delivers up to {@link OUTBOX_BATCH_SIZE} pending messages for the tenant this
   * instance's `OutboxRepository` is scoped to. Returns how many messages were claimed and how many
   * were fully delivered (processed) in this pass — purely for caller-side logging/tests.
   *
   * **At-least-once, never more-than-attempted**: every consumer whose `eventTypes` matches the
   * message is invoked at most once per delivery attempt, guarded by
   * `OutboxRepository.hasProcessed`/`markProcessedByConsumer` so a message redelivered after a
   * partial-batch failure never re-runs a consumer that already durably succeeded for it.
   */
  async processTenantBatch(workerId: string): Promise<{ claimed: number; delivered: number }> {
    const claimed = await this.outbox.claimBatch(workerId, OUTBOX_BATCH_SIZE);
    let delivered = 0;
    for (const message of claimed) {
      const ok = await this.deliverOne(message);
      if (ok) delivered += 1;
    }
    return { claimed: claimed.length, delivered };
  }

  /** Delivers one claimed message to every matching consumer, then marks it processed or records
   * the failure. Returns whether it ended up fully delivered. */
  private async deliverOne(message: ClaimedOutboxMessage): Promise<boolean> {
    const matching = this.consumers.filter((c) => c.eventTypes.includes(message.eventType));
    let firstError: string | null = null;

    for (const consumer of matching) {
      if (await this.outbox.hasProcessed(consumer.name, message.id)) {
        continue; // Already durably handled by this consumer on a prior delivery attempt.
      }
      try {
        await consumer.handle(message.payload, message.id);
        await this.outbox.markProcessedByConsumer(consumer.name, message.id);
      } catch (err) {
        // One consumer's failure never blocks another consumer's delivery of the same message —
        // each is independently idempotency-guarded, so the next tick retries only what's left.
        firstError = firstError ?? (err instanceof Error ? err.message : String(err));
        this.logger.warn({ err, eventId: message.id, consumer: consumer.name }, 'outbox_consumer_failed');
      }
    }

    if (firstError) {
      await this.outbox.recordFailure(message.id, message.attempts, firstError);
      if (this.outbox.isDeadLetter(message.attempts + 1)) {
        this.logger.error({ eventId: message.id, eventType: message.eventType }, 'outbox_dead_letter');
      }
      return false;
    }

    await this.outbox.markMessageProcessed(message.id);
    return true;
  }
}
