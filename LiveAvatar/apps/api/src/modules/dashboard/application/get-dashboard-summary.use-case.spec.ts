import { GetDashboardSummaryUseCase } from './get-dashboard-summary.use-case';

describe('GetDashboardSummaryUseCase', () => {
  function make() {
    const stats = {
      countActiveTenants: jest.fn().mockResolvedValue(2),
      countSessionsByOutcome: jest.fn().mockResolvedValue({ started: 10, ended: 6, failed: 2, abandoned: 1 }),
    };
    const useCase = new GetDashboardSummaryUseCase(stats as never);
    return { useCase, stats };
  }

  it('operator with no tenant_id scopes with a null filter', async () => {
    const { useCase, stats } = make();
    await useCase.execute({ id: 'a1', email: 'a@x.com', roles: ['operator'], tenantIds: [] }, {});
    expect(stats.countActiveTenants).toHaveBeenCalledWith(null);
  });

  it('admin with no tenant_id scopes to their own assigned tenants', async () => {
    const { useCase, stats } = make();
    await useCase.execute({ id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1', 't2'] }, {});
    expect(stats.countActiveTenants).toHaveBeenCalledWith(['t1', 't2']);
  });

  it('admin naming an unassigned tenant_id scopes to an empty set (not an error)', async () => {
    const { useCase, stats } = make();
    await useCase.execute({ id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'] }, { tenant_id: 't2' });
    expect(stats.countActiveTenants).toHaveBeenCalledWith([]);
  });

  it('defaults the range to 24h', async () => {
    const { useCase } = make();
    const result = await useCase.execute({ id: 'a1', email: 'a@x.com', roles: ['operator'], tenantIds: [] }, {});
    expect(result.range).toBe('24h');
  });

  it('computes error_rate as failed/started', async () => {
    const { useCase } = make();
    const result = await useCase.execute({ id: 'a1', email: 'a@x.com', roles: ['operator'], tenantIds: [] }, {});
    expect(result.error_rate).toBe(0.2);
    expect(result.active_deployments).toBe(2);
    expect(result.sessions).toEqual({ started: 10, ended: 6, failed: 2, abandoned: 1 });
  });

  it('error_rate is 0 (not NaN) when there are zero sessions', async () => {
    const { useCase, stats } = make();
    stats.countSessionsByOutcome.mockResolvedValue({ started: 0, ended: 0, failed: 0, abandoned: 0 });
    const result = await useCase.execute({ id: 'a1', email: 'a@x.com', roles: ['operator'], tenantIds: [] }, {});
    expect(result.error_rate).toBe(0);
  });
});
