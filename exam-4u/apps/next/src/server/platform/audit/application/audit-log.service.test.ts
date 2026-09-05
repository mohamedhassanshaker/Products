import { describe, expect, it, vi } from 'vitest';
import type pino from 'pino';
import { AuditLogService } from './audit-log.service';
import type { AuditLogRepository } from '../infrastructure/audit-log.repository';

function makeService(overrides?: { repo?: Partial<AuditLogRepository> }) {
  const repo = {
    append: vi.fn().mockResolvedValue(undefined),
    findMany: vi.fn(),
    findByTenant: vi.fn(),
    ...overrides?.repo,
  } as unknown as AuditLogRepository;
  const logger = { error: vi.fn() } as unknown as pino.Logger;
  const service = new AuditLogService(repo, logger);
  return { service, repo, logger };
}

/** Unit coverage for `AuditLogService` — ported test cases from `legacy/api/src/platform/audit/
 * application/audit-log.service.spec.ts`, translated to vitest. The fail-open guarantee (a logging
 * failure must never abort the mutating action it records) is this dispatch's own security/reliability
 * exit-gate item — proven here with a real forced-failure repository, not just asserted in prose. */
describe('AuditLogService', () => {
  it('appends the entry via the repository', async () => {
    const { service, repo } = makeService();
    const entry = { actorType: 'PlatformAdmin' as const, action: 'tenant.create' };
    await service.record(entry);
    expect(repo.append).toHaveBeenCalledWith(entry);
  });

  it('never throws when the repository write fails — logs instead (fail-open)', async () => {
    const { service, logger } = makeService({
      repo: { append: vi.fn().mockRejectedValue(new Error('db exploded')) },
    });
    await expect(service.record({ actorType: 'System', action: 'x' })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'audit_log_write_failed',
    );
  });

  it('a caller awaiting record() genuinely sees the primary action already resolved, regardless of the audit write outcome', async () => {
    // Simulates the exact retrofit pattern every mutating Route Handler now follows: perform the
    // primary action, THEN call record() and never let its outcome affect the response.
    const { service } = makeService({ repo: { append: vi.fn().mockRejectedValue(new Error('audit db down')) } });
    let primaryActionSucceeded = false;

    async function simulatedRouteHandler(): Promise<{ ok: true }> {
      primaryActionSucceeded = true; // the "real" mutation, already committed
      await service.record({ actorType: 'PlatformAdmin', action: 'tenant.suspend' });
      return { ok: true };
    }

    await expect(simulatedRouteHandler()).resolves.toEqual({ ok: true });
    expect(primaryActionSucceeded).toBe(true);
  });

  it('list() delegates to the repository findMany() unchanged', async () => {
    const { service, repo } = makeService({
      repo: { findMany: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
    });
    const options = { actorId: 'admin-1', page: 2, pageSize: 10 };
    const result = await service.list(options);
    expect(repo.findMany).toHaveBeenCalledWith(options);
    expect(result).toEqual({ items: [], total: 0 });
  });
});
