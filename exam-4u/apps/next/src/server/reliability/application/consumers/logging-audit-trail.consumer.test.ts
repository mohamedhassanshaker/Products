import { describe, expect, it, vi } from 'vitest';
import { LoggingAuditTrailConsumer } from './logging-audit-trail.consumer';

describe('LoggingAuditTrailConsumer', () => {
  it('is registered for user.created and logs the event without throwing', async () => {
    const logger = { info: vi.fn() } as unknown as ConstructorParameters<typeof LoggingAuditTrailConsumer>[0];
    const consumer = new LoggingAuditTrailConsumer(logger);

    expect(consumer.name).toBe('logging-audit-trail');
    expect(consumer.eventTypes).toEqual(['user.created']);

    await expect(consumer.handle({ userId: 'u1', email: 'a@b.com' }, 'evt-1')).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-1', userId: 'u1', email: 'a@b.com' }),
      'outbox.user.created',
    );
  });
});
