import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DataSource } from 'typeorm';
import { FileCleanupRepository } from './file-cleanup.repository';

function fakeManager() {
  const ormRepo = {
    insert: vi.fn(async () => undefined),
    find: vi.fn(async () => [] as unknown[]),
    update: vi.fn(async () => undefined),
  };
  const manager = { getRepository: vi.fn(() => ormRepo) };
  return { manager, ormRepo };
}

function makeRepository() {
  const { manager, ormRepo } = fakeManager();
  const dataSource = { manager } as unknown as DataSource;
  const repository = new FileCleanupRepository(dataSource);
  return { repository, manager, ormRepo, dataSource };
}

describe('FileCleanupRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('schedule() inserts a new pending row against the default (non-transactional) manager', async () => {
    const { repository, ormRepo } = makeRepository();
    await repository.schedule('tenants/t1/avatars/u1/old.png');
    expect(ormRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: 'tenants/t1/avatars/u1/old.png', deletedAt: null, attempts: 0 }),
    );
  });

  it('schedule() uses an explicitly-provided (e.g. transactional) EntityManager when given one', async () => {
    const { repository, ormRepo: defaultOrmRepo } = makeRepository();
    const txOrmRepo = { insert: vi.fn(async () => undefined) };
    const txManager = { getRepository: vi.fn(() => txOrmRepo) } as unknown as import('typeorm').EntityManager;

    await repository.schedule('tenants/t1/x.png', txManager);

    expect(txOrmRepo.insert).toHaveBeenCalled();
    expect(defaultOrmRepo.insert).not.toHaveBeenCalled();
  });

  it('findDue() returns pending rows, oldest-first, capped at the given limit', async () => {
    const { repository, ormRepo } = makeRepository();
    await repository.findDue(10);
    expect(ormRepo.find).toHaveBeenCalledWith(expect.objectContaining({ order: { scheduledAt: 'ASC' }, take: 10 }));
  });

  it('markDeleted() stamps deletedAt', async () => {
    const { repository, ormRepo } = makeRepository();
    await repository.markDeleted('id-1');
    expect(ormRepo.update).toHaveBeenCalledWith({ id: 'id-1' }, { deletedAt: expect.any(Date) });
  });

  it('recordFailedAttempt() increments attempts from the given count', async () => {
    const { repository, ormRepo } = makeRepository();
    await repository.recordFailedAttempt('id-1', 2);
    expect(ormRepo.update).toHaveBeenCalledWith({ id: 'id-1' }, { attempts: 3 });
  });
});
