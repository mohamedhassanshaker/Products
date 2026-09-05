/**
 * One in-process side-effect handler for outbox events (FR-REL-1) — ported verbatim (interface
 * unchanged) from `legacy/api/src/modules/reliability/domain/outbox-consumer.port.ts`.
 * `OutboxPublisherService` dispatches every claimed `outbox_message` row to every registered consumer
 * whose {@link OutboxConsumer.eventTypes} includes that row's `event_type`, guarding each dispatch
 * with `processed_event(consumer=name, event_id)` so a handler is never re-run for an event it has
 * already durably processed — this is what makes "must tolerate receiving the same event more than
 * once" (FR-REL-1) the *publisher's* structural guarantee rather than something each handler has to
 * remember to implement itself.
 *
 * Unlike legacy, there is no DI multi-provider token here (`OUTBOX_CONSUMERS`) — this app has no DI
 * container; the worker's own composition root (`server/workers/outbox-publisher.ts`) builds the
 * consumer array by plain construction instead.
 */
export interface OutboxConsumer {
  /** Stable identity used as `processed_event.consumer` — renaming this constant after a consumer
   * has shipped would make every already-processed event for it look unprocessed again, so treat it
   * as a durable key, not a display label. */
  readonly name: string;

  /** The `outbox_message.event_type` values this consumer wants delivered to it. */
  readonly eventTypes: string[];

  /** @throws whatever the underlying side effect throws — `OutboxPublisherService` catches
   * per-consumer, records the failure on the message row (`attempts`/`last_error`/backoff
   * `available_at`), and retries later; it never lets one consumer's failure block another
   * consumer's delivery of the same message. */
  handle(payload: Record<string, unknown>, eventId: string): Promise<void>;
}

/** One claimed batch member, shaped for `OutboxPublisherService`'s dispatch loop — ported verbatim
 * from `legacy/api/src/modules/reliability/infrastructure/repositories/outbox.repository.ts`'s
 * `ClaimedOutboxMessage`. */
export interface ClaimedOutboxMessage {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
}
