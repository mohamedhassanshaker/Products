import { GetFailoverStatsUseCase } from './get-failover-stats.use-case';

const actor = { id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'] };

describe('GetFailoverStatsUseCase', () => {
  function make() {
    const tenants = { findById: jest.fn().mockResolvedValue({ id: 't1' }) };
    const hops = { countLlmFailoverStats: jest.fn().mockResolvedValue({ primaryFailures: 5, fallbackSuccesses: 3, degradedInvocations: 2 }) };
    const useCase = new GetFailoverStatsUseCase(tenants as never, hops as never);
    return { useCase, tenants, hops };
  }

  it('404s for an unknown tenant', async () => {
    const { useCase, tenants } = make();
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 't1', {})).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('defaults to a 24h range', async () => {
    const { useCase, hops } = make();
    await useCase.execute(actor, 't1', {});
    const since = hops.countLlmFailoverStats.mock.calls[0][1] as Date;
    expect(Date.now() - since.getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -3);
  });

  it('honors an explicit range', async () => {
    const { useCase, hops } = make();
    await useCase.execute(actor, 't1', { range: '1h' });
    const since = hops.countLlmFailoverStats.mock.calls[0][1] as Date;
    expect(Date.now() - since.getTime()).toBeCloseTo(60 * 60 * 1000, -3);
  });

  it('returns the mapped stats DTO', async () => {
    const { useCase } = make();
    const result = await useCase.execute(actor, 't1', { range: '7d' });
    expect(result).toEqual({ primary_failures: 5, fallback_successes: 3, degraded_invocations: 2 });
  });
});
