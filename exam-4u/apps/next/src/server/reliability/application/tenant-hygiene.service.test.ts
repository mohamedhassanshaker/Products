import { describe, expect, it, vi } from 'vitest';
import type pino from 'pino';
import { TenantHygieneService } from './tenant-hygiene.service';
import type { FileCleanupRepository } from '../infrastructure/file-cleanup.repository';
import type { UserRepository } from '@/server/auth';
import type { StoragePort } from '@/server/common/ports/storage.port';

/** Unit coverage for `TenantHygieneService` (HLD §10.1's two tenant-schema hygiene duties) — ported
 * test cases from `legacy/api/src/modules/reliability/application/tenant-hygiene.service.spec.ts`,
 * translated to vitest. Drives `drainFileCleanupQueue`'s success/storage-failure branches directly
 * (this dispatch's own exit-gate requirement: "hygiene batch-tolerant-of-one-failure behavior"). */
function makeLogger(): pino.Logger {
  return { warn: vi.fn() } as unknown as pino.Logger;
}

function makeService(overrides?: { due?: { id: string; storageKey: string; attempts: number }[] }) {
  const users = { pruneExpiredResetTokens: vi.fn().mockResolvedValue(0) } as unknown as UserRepository;
  const fileCleanup = {
    findDue: vi.fn().mockResolvedValue(overrides?.due ?? []),
    markDeleted: vi.fn().mockResolvedValue(undefined),
    recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
    countDue: vi.fn(),
  } as unknown as FileCleanupRepository;
  const storage = { delete: vi.fn().mockResolvedValue(undefined) } as unknown as StoragePort;
  const logger = makeLogger();
  return { service: new TenantHygieneService(users, fileCleanup, storage, logger), users, fileCleanup, storage, logger };
}

describe('TenantHygieneService', () => {
  describe('pruneExpiredResetTokens', () => {
    it('delegates to UserRepository.pruneExpiredResetTokens() and returns its count', async () => {
      const { service, users } = makeService();
      (users.pruneExpiredResetTokens as ReturnType<typeof vi.fn>).mockResolvedValue(4);
      expect(await service.pruneExpiredResetTokens()).toBe(4);
    });
  });

  describe('drainFileCleanupQueue', () => {
    it('returns 0 when nothing is due', async () => {
      const { service } = makeService({ due: [] });
      expect(await service.drainFileCleanupQueue()).toBe(0);
    });

    it('deletes from storage then marks each due row deleted, counting only actual deletes', async () => {
      const { service, fileCleanup, storage } = makeService({
        due: [
          { id: 'r1', storageKey: 'k1', attempts: 0 },
          { id: 'r2', storageKey: 'k2', attempts: 0 },
        ],
      });

      const deleted = await service.drainFileCleanupQueue();

      expect(storage.delete).toHaveBeenCalledWith('k1');
      expect(storage.delete).toHaveBeenCalledWith('k2');
      expect(fileCleanup.markDeleted).toHaveBeenCalledWith('r1');
      expect(fileCleanup.markDeleted).toHaveBeenCalledWith('r2');
      expect(deleted).toBe(2);
    });

    it('records a failed attempt (never marks deleted) when storage.delete() throws, without blocking the rest of the batch', async () => {
      const storage = {
        delete: vi.fn().mockRejectedValueOnce(new Error('object not found')).mockResolvedValueOnce(undefined),
      } as unknown as StoragePort;
      const fileCleanup = {
        findDue: vi.fn().mockResolvedValue([
          { id: 'r1', storageKey: 'k1', attempts: 1 },
          { id: 'r2', storageKey: 'k2', attempts: 0 },
        ]),
        markDeleted: vi.fn().mockResolvedValue(undefined),
        recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
        countDue: vi.fn(),
      } as unknown as FileCleanupRepository;
      const users = { pruneExpiredResetTokens: vi.fn() } as unknown as UserRepository;
      const logger = makeLogger();
      const service = new TenantHygieneService(users, fileCleanup, storage, logger);

      const deleted = await service.drainFileCleanupQueue();

      expect(fileCleanup.recordFailedAttempt).toHaveBeenCalledWith('r1', 1);
      expect(fileCleanup.markDeleted).not.toHaveBeenCalledWith('r1');
      expect(fileCleanup.markDeleted).toHaveBeenCalledWith('r2');
      expect(deleted).toBe(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ storageKey: 'k1' }), 'file_cleanup_delete_failed');
    });
  });
});
