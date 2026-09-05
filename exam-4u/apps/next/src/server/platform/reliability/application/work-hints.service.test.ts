import { describe, expect, it, vi } from 'vitest';
import { WorkHintsService } from './work-hints.service';
import type { WorkHintRepository } from '../infrastructure/work-hint.repository';

/** Unit coverage for `WorkHintsService` — ported test cases from `legacy/api/src/platform/
 * reliability/application/work-hints.service.spec.ts`, translated to vitest, plus new coverage for
 * `countByKind` (this dispatch's own new Reliability dashboard read path). Proves every method
 * delegates its arguments/return value unchanged — a thin facade, no logic of its own. */
describe('WorkHintsService', () => {
  it('listTenantIds() delegates to WorkHintRepository.listTenantIds() with kind and limit', async () => {
    const repo = {
      listTenantIds: vi.fn().mockResolvedValue(['t1', 't2']),
      countByKind: vi.fn(),
      clear: vi.fn(),
    } as unknown as WorkHintRepository;
    const service = new WorkHintsService(repo);

    const result = await service.listTenantIds('outbox', 100);

    expect(repo.listTenantIds).toHaveBeenCalledWith('outbox', 100);
    expect(result).toEqual(['t1', 't2']);
  });

  it('countByKind() delegates to WorkHintRepository.countByKind()', async () => {
    const repo = {
      listTenantIds: vi.fn(),
      countByKind: vi.fn().mockResolvedValue(3),
      clear: vi.fn(),
    } as unknown as WorkHintRepository;
    const service = new WorkHintsService(repo);

    const result = await service.countByKind('pdf_session');

    expect(repo.countByKind).toHaveBeenCalledWith('pdf_session');
    expect(result).toBe(3);
  });

  it('clear() delegates to WorkHintRepository.clear() with tenantId and kind', async () => {
    const repo = {
      listTenantIds: vi.fn(),
      countByKind: vi.fn(),
      clear: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorkHintRepository;
    const service = new WorkHintsService(repo);

    await service.clear('tenant-1', 'outbox');

    expect(repo.clear).toHaveBeenCalledWith('tenant-1', 'outbox');
  });
});
