import { AlertsController } from './alerts.controller';

describe('AlertsController', () => {
  function make() {
    const getAlertPolicy = { execute: jest.fn().mockResolvedValue({ retry_max_attempts: 3 }) };
    const updateAlertPolicy = { execute: jest.fn().mockResolvedValue({ retry_max_attempts: 4 }) };
    const listAlerts = { execute: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    const getFailoverStats = { execute: jest.fn().mockResolvedValue({ primary_failures: 0 }) };
    const controller = new AlertsController(getAlertPolicy as never, updateAlertPolicy as never, listAlerts as never, getFailoverStats as never);
    return { controller, getAlertPolicy, updateAlertPolicy, listAlerts, getFailoverStats };
  }

  const actor = { id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'] };

  it('policy delegates to GetAlertPolicyUseCase', async () => {
    const { controller, getAlertPolicy } = make();
    await controller.policy(actor as never, 't1');
    expect(getAlertPolicy.execute).toHaveBeenCalledWith(actor, 't1');
  });

  it('updatePolicy delegates to UpdateAlertPolicyUseCase with If-Match', async () => {
    const { controller, updateAlertPolicy } = make();
    const body = { retry_max_attempts: 4, retry_backoff_ms: [1, 2, 3, 4], degraded_mode_message: 'm' };
    await controller.updatePolicy(actor as never, 't1', body as never, 'if-match');
    expect(updateAlertPolicy.execute).toHaveBeenCalledWith(actor, 't1', body, 'if-match');
  });

  it('list delegates to ListAlertsUseCase', async () => {
    const { controller, listAlerts } = make();
    await controller.list(actor as never, 't1', { type: 'gpu_unhealthy' } as never);
    expect(listAlerts.execute).toHaveBeenCalledWith(actor, 't1', { type: 'gpu_unhealthy' });
  });

  it('failoverStats delegates to GetFailoverStatsUseCase', async () => {
    const { controller, getFailoverStats } = make();
    await controller.failoverStats(actor as never, 't1', { range: '7d' } as never);
    expect(getFailoverStats.execute).toHaveBeenCalledWith(actor, 't1', { range: '7d' });
  });
});
