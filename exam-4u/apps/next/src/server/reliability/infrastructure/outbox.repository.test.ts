import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DataSource } from 'typeorm';
import { OutboxRepository } from './outbox.repository';

/** In-memory fake `EntityManager`/`DataSource` — mirrors legacy's `outbox.repository.spec.ts` fake
 * shape, adapted to this app's constructor-takes-DataSource convention (no `TenantContextService`). */
function fakeManager() {
  const outboxOrmRepo = {
    create: vi.fn((data: unknown) => data),
    save: vi.fn(async (entity: unknown) => entity),
    find: vi.fn(async () => [] as unknown[]),
    count: vi.fn(async () => 0),
  };
  const processedOrmRepo = {
    findOne: vi.fn(async (): Promise<{ consumer: string; eventId: string } | null> => null),
    insert: vi.fn(async (): Promise<void> => undefined),
  };
  const manager = {
    getRepository: vi.fn((name: string) => {
      if (name === 'outbox_message') return outboxOrmRepo;
      if (name === 'processed_event') return processedOrmRepo;
      throw new Error(`unexpected repository requested: ${name}`);
    }),
    query: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
  };
  return { manager, outboxOrmRepo, processedOrmRepo };
}

function makeRepository() {
  const { manager, outboxOrmRepo, processedOrmRepo } = fakeManager();
  const dataSource = { manager } as unknown as DataSource;
  const repository = new OutboxRepository(dataSource);
  return { repository, manager, outboxOrmRepo, processedOrmRepo, dataSource };
}

describe('OutboxRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('enqueue', () => {
    it('saves a new outbox_message row via the given EntityManager, needing no ambient tenant scope', async () => {
      const { repository, manager, outboxOrmRepo } = makeRepository();

      const id = await repository.enqueue(manager as never, 'user.created', { userId: 'u1' });

      expect(typeof id).toBe('string');
      expect(outboxOrmRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id, eventType: 'user.created', payload: { userId: 'u1' }, attempts: 0, processedAt: null }),
      );
      // `availableAt` is deliberately absent from the saved object — MySQL's own
      // DEFAULT CURRENT_TIMESTAMP(3) populates it server-side (see the repository's own doc comment).
      expect(outboxOrmRepo.save.mock.calls[0][0]).not.toHaveProperty('availableAt');
    });
  });

  describe('claimBatch', () => {
    it('claims via the raw UPDATE then reads back only rows locked by this workerId', async () => {
      const { repository, manager, outboxOrmRepo } = makeRepository();
      outboxOrmRepo.find.mockResolvedValue([{ id: 'm-1', eventType: 'user.created', payload: {}, attempts: 0 }]);

      const claimed = await repository.claimBatch('worker-1', 50);

      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE outbox_message'), ['worker-1', 50]);
      expect(claimed).toEqual([{ id: 'm-1', eventType: 'user.created', payload: {}, attempts: 0 }]);
    });
  });

  describe('hasProcessed', () => {
    it('returns true when a processed_event row exists', async () => {
      const { repository, processedOrmRepo } = makeRepository();
      processedOrmRepo.findOne.mockResolvedValue({ consumer: 'c', eventId: 'e1' });
      expect(await repository.hasProcessed('c', 'e1')).toBe(true);
    });

    it('returns false otherwise', async () => {
      const { repository } = makeRepository();
      expect(await repository.hasProcessed('c', 'e1')).toBe(false);
    });
  });

  describe('markProcessedByConsumer', () => {
    it('inserts a processed_event row', async () => {
      const { repository, processedOrmRepo } = makeRepository();
      await repository.markProcessedByConsumer('c', 'e1');
      expect(processedOrmRepo.insert).toHaveBeenCalledWith({ consumer: 'c', eventId: 'e1', processedAt: expect.any(Date) });
    });

    it('swallows a duplicate-key insert failure rather than throwing', async () => {
      const { repository, processedOrmRepo } = makeRepository();
      processedOrmRepo.insert.mockRejectedValue(new Error('ER_DUP_ENTRY'));
      await expect(repository.markProcessedByConsumer('c', 'e1')).resolves.toBeUndefined();
    });
  });

  describe('markMessageProcessed', () => {
    it('issues the raw UPDATE with the message id', async () => {
      const { repository, manager } = makeRepository();
      await repository.markMessageProcessed('e1');
      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE outbox_message'), ['e1']);
    });
  });

  describe('recordFailure', () => {
    it('increments attempts and computes exponential backoff capped at 300s', async () => {
      const { repository, manager } = makeRepository();
      await repository.recordFailure('e1', 9, 'boom');
      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE outbox_message'), [10, 'boom', 300, 'e1']);
    });

    it('truncates an overly long error message to 1000 characters', async () => {
      const { repository, manager } = makeRepository();
      await repository.recordFailure('e1', 0, 'x'.repeat(2000));
      const call = manager.query.mock.calls.find((c) => (c[0] as string).includes('last_error'));
      expect((call![1] as unknown[])[1]).toHaveLength(1000);
    });
  });

  describe('isDeadLetter', () => {
    it('is false below the threshold, true at/above it', () => {
      const { repository } = makeRepository();
      expect(repository.isDeadLetter(9)).toBe(false);
      expect(repository.isDeadLetter(10)).toBe(true);
      expect(repository.isDeadLetter(11)).toBe(true);
    });
  });

  describe('hasPending', () => {
    it('reflects the unprocessed-row count', async () => {
      const { repository, outboxOrmRepo } = makeRepository();
      outboxOrmRepo.count.mockResolvedValue(3);
      expect(await repository.hasPending()).toBe(true);
      outboxOrmRepo.count.mockResolvedValue(0);
      expect(await repository.hasPending()).toBe(false);
    });
  });
});
