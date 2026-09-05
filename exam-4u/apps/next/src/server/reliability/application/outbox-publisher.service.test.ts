import { describe, expect, it, vi } from 'vitest';
import { OutboxPublisherService } from './outbox-publisher.service';
import type { OutboxRepository } from '../infrastructure/outbox.repository';
import type { ClaimedOutboxMessage, OutboxConsumer } from '../domain/outbox-consumer.types';

/** Unit coverage for `OutboxPublisherService` — adapted from legacy's
 * `outbox-publisher.worker.spec.ts`'s `processTenantBatch`/`deliverOne` section (the tenant-
 * iteration/hinted-sweep tests don't apply here — that orchestration moved to
 * `server/workers/outbox-publisher.ts`, proven instead by the real-MySQL integration test). */
function fakeMessage(overrides: Partial<ClaimedOutboxMessage> = {}): ClaimedOutboxMessage {
  return { id: 'evt-1', eventType: 'user.created', payload: {}, attempts: 0, ...overrides };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ConstructorParameters<typeof OutboxPublisherService>[2];
}

function makePublisher(overrides?: { claimed?: ClaimedOutboxMessage[]; consumers?: OutboxConsumer[]; hasProcessed?: ReturnType<typeof vi.fn> }) {
  const outbox = {
    claimBatch: vi.fn(async () => overrides?.claimed ?? []),
    hasProcessed: overrides?.hasProcessed ?? vi.fn(async () => false),
    markProcessedByConsumer: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => undefined),
    markMessageProcessed: vi.fn(async () => undefined),
    isDeadLetter: vi.fn(() => false),
  } as unknown as OutboxRepository;

  const logger = makeLogger();
  const publisher = new OutboxPublisherService(outbox, overrides?.consumers ?? [], logger);
  return { publisher, outbox, logger };
}

describe('OutboxPublisherService.processTenantBatch', () => {
  it('returns zero claimed/delivered when nothing is pending', async () => {
    const { publisher, outbox } = makePublisher({ claimed: [] });
    const result = await publisher.processTenantBatch('worker-1');
    expect(result).toEqual({ claimed: 0, delivered: 0 });
    expect(outbox.claimBatch).toHaveBeenCalledWith('worker-1', 50);
  });

  it('delivers a message to every matching consumer and marks it fully processed', async () => {
    const consumer: OutboxConsumer = { name: 'logging-audit-trail', eventTypes: ['user.created'], handle: vi.fn(async () => undefined) };
    const { publisher, outbox } = makePublisher({ claimed: [fakeMessage()], consumers: [consumer] });

    const result = await publisher.processTenantBatch('worker-1');

    expect(consumer.handle).toHaveBeenCalledWith({}, 'evt-1');
    expect(outbox.markProcessedByConsumer).toHaveBeenCalledWith('logging-audit-trail', 'evt-1');
    expect(outbox.markMessageProcessed).toHaveBeenCalledWith('evt-1');
    expect(result).toEqual({ claimed: 1, delivered: 1 });
  });

  it('skips a consumer already known to have processed the message (idempotency guard)', async () => {
    const consumer: OutboxConsumer = { name: 'logging-audit-trail', eventTypes: ['user.created'], handle: vi.fn() };
    const { publisher, outbox } = makePublisher({ claimed: [fakeMessage()], consumers: [consumer], hasProcessed: vi.fn(async () => true) });

    await publisher.processTenantBatch('worker-1');

    expect(consumer.handle).not.toHaveBeenCalled();
    expect(outbox.markMessageProcessed).toHaveBeenCalledWith('evt-1');
  });

  it('never dispatches to a consumer whose eventTypes does not include this message type', async () => {
    const consumer: OutboxConsumer = { name: 'other', eventTypes: ['someOther.event'], handle: vi.fn() };
    const { publisher } = makePublisher({ claimed: [fakeMessage()], consumers: [consumer] });
    await publisher.processTenantBatch('worker-1');
    expect(consumer.handle).not.toHaveBeenCalled();
  });

  it("records a failure (never marks fully processed) when a consumer's handle() throws", async () => {
    const consumer: OutboxConsumer = {
      name: 'logging-audit-trail',
      eventTypes: ['user.created'],
      handle: vi.fn(async () => {
        throw new Error('downstream boom');
      }),
    };
    const { publisher, outbox, logger } = makePublisher({ claimed: [fakeMessage({ attempts: 2 })], consumers: [consumer] });

    const result = await publisher.processTenantBatch('worker-1');

    expect(outbox.recordFailure).toHaveBeenCalledWith('evt-1', 2, 'downstream boom');
    expect(outbox.markMessageProcessed).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ consumer: 'logging-audit-trail' }), 'outbox_consumer_failed');
    expect(result).toEqual({ claimed: 1, delivered: 0 });
  });

  it('logs a dead-letter warning once the failed attempt count reaches the dead-letter threshold', async () => {
    const consumer: OutboxConsumer = {
      name: 'c',
      eventTypes: ['user.created'],
      handle: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const { publisher, outbox, logger } = makePublisher({ claimed: [fakeMessage({ attempts: 9 })], consumers: [consumer] });
    (outbox.isDeadLetter as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await publisher.processTenantBatch('worker-1');

    expect(outbox.isDeadLetter).toHaveBeenCalledWith(10);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'evt-1' }), 'outbox_dead_letter');
  });

  it('a non-Error throw is stringified rather than crashing the delivery loop', async () => {
    const consumer: OutboxConsumer = { name: 'c', eventTypes: ['user.created'], handle: vi.fn(async () => Promise.reject('plain string failure')) };
    const { publisher, outbox } = makePublisher({ claimed: [fakeMessage()], consumers: [consumer] });
    await publisher.processTenantBatch('worker-1');
    expect(outbox.recordFailure).toHaveBeenCalledWith('evt-1', 0, 'plain string failure');
  });

  it("one consumer's failure never blocks delivery of the same message to the next matching consumer", async () => {
    const failing: OutboxConsumer = {
      name: 'a',
      eventTypes: ['user.created'],
      handle: vi.fn(async () => {
        throw new Error('x');
      }),
    };
    const succeeding: OutboxConsumer = { name: 'b', eventTypes: ['user.created'], handle: vi.fn(async () => undefined) };
    const { publisher, outbox } = makePublisher({ claimed: [fakeMessage()], consumers: [failing, succeeding] });

    await publisher.processTenantBatch('worker-1');

    expect(succeeding.handle).toHaveBeenCalled();
    expect(outbox.markProcessedByConsumer).toHaveBeenCalledWith('b', 'evt-1');
  });

  it('delivers multiple claimed messages in one batch, independently', async () => {
    const consumer: OutboxConsumer = { name: 'c', eventTypes: ['user.created'], handle: vi.fn(async () => undefined) };
    const { publisher, outbox } = makePublisher({ claimed: [fakeMessage({ id: 'e1' }), fakeMessage({ id: 'e2' })], consumers: [consumer] });

    const result = await publisher.processTenantBatch('worker-1');

    expect(result).toEqual({ claimed: 2, delivered: 2 });
    expect(outbox.markMessageProcessed).toHaveBeenCalledWith('e1');
    expect(outbox.markMessageProcessed).toHaveBeenCalledWith('e2');
  });
});
