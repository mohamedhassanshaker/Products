import { ListAlertsUseCase } from './list-alerts.use-case';

const actor = { id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'] };

describe('ListAlertsUseCase', () => {
  function make() {
    const tenants = { findById: jest.fn().mockResolvedValue({ id: 't1' }) };
    const alerts = { list: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    const useCase = new ListAlertsUseCase(tenants as never, alerts as never);
    return { useCase, tenants, alerts };
  }

  it('404s for an unknown tenant', async () => {
    const { useCase, tenants } = make();
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 't1', {})).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('defaults to a 7-day window when from/to are omitted', async () => {
    const { useCase, alerts } = make();
    await useCase.execute(actor, 't1', {});
    const call = alerts.list.mock.calls[0][0];
    const spanMs = call.to.getTime() - call.from.getTime();
    expect(spanMs).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3);
  });

  it('400s SESS_RANGE_INVALID when from is after to', async () => {
    const { useCase } = make();
    await expect(
      useCase.execute(actor, 't1', { from: '2026-01-10T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'SESS_RANGE_INVALID' });
  });

  it('maps rows into the wire DTO', async () => {
    const { useCase, alerts } = make();
    alerts.list.mockResolvedValue({ items: [{ id: 'a1', type: 'llm_failover', message: 'Failover.', createdAt: new Date('2026-01-01T00:00:00.000Z') }], total: 1 });
    const result = await useCase.execute(actor, 't1', {});
    expect(result).toEqual({ items: [{ id: 'a1', type: 'llm_failover', message: 'Failover.', created_at: '2026-01-01T00:00:00.000Z' }], total: 1 });
  });
});
