import { DashboardController } from './dashboard.controller';

describe('DashboardController', () => {
  function make() {
    const getSummary = { execute: jest.fn().mockResolvedValue({ active_deployments: 1 }) };
    const getProviderHealth = { execute: jest.fn().mockResolvedValue({ categories: [] }) };
    const controller = new DashboardController(getSummary as never, getProviderHealth as never);
    return { controller, getSummary, getProviderHealth };
  }

  const actor = { id: 'a1', email: 'a@x.com', roles: ['operator'], tenantIds: [] };

  it('summary delegates to GetDashboardSummaryUseCase', async () => {
    const { controller, getSummary } = make();
    await controller.summary(actor as never, { range: '7d' } as never);
    expect(getSummary.execute).toHaveBeenCalledWith(actor, { range: '7d' });
  });

  it('providerHealth delegates to GetProviderHealthUseCase', async () => {
    const { controller, getProviderHealth } = make();
    const result = await controller.providerHealth();
    expect(getProviderHealth.execute).toHaveBeenCalled();
    expect(result).toEqual({ categories: [] });
  });
});
