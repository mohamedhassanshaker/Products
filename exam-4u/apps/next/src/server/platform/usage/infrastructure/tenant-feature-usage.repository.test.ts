import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { TenantFeatureUsageRepository } from './tenant-feature-usage.repository';

/** Ported verbatim (fake-`DataSource` shape) from
 * `legacy/api/src/platform/usage/infrastructure/repositories/tenant-feature-usage.repository.spec.ts`. */

function fakeDataSource(query: ReturnType<typeof vi.fn>): DataSource {
  return { query } as unknown as DataSource;
}

describe('TenantFeatureUsageRepository', () => {
  it('getCount() returns 0 when no usage row exists yet (no row is created just to read it)', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repo = new TenantFeatureUsageRepository(fakeDataSource(query));
    const count = await repo.getCount('tenant-1', 'feature-1', '2026-08');
    expect(count).toBe(0);
    expect(query.mock.calls[0][0]).toContain('SELECT count FROM tenant_feature_usage');
    expect(query.mock.calls[0][1]).toEqual(['tenant-1', 'feature-1', '2026-08']);
  });

  it('getCount() returns the stored count when a row exists', async () => {
    const query = vi.fn().mockResolvedValue([{ count: 7 }]);
    const repo = new TenantFeatureUsageRepository(fakeDataSource(query));
    await expect(repo.getCount('tenant-1', 'feature-1', '2026-08')).resolves.toBe(7);
  });

  it('incrementCount() issues an atomic INSERT ... ON DUPLICATE KEY UPDATE count = count + 1', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const repo = new TenantFeatureUsageRepository(fakeDataSource(query));
    await repo.incrementCount('tenant-1', 'feature-1', '2026-08');
    expect(query.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE count = count + 1');
    expect(query.mock.calls[0][1]).toEqual([expect.any(String), 'tenant-1', 'feature-1', '2026-08']);
  });
});
