import { RecordAlertUseCase } from './record-alert.use-case';

describe('RecordAlertUseCase', () => {
  it('creates an AlertEvent from the wire request', async () => {
    const alerts = { create: jest.fn().mockResolvedValue(undefined) };
    const useCase = new RecordAlertUseCase(alerts as never);

    await useCase.execute({ tenant_id: 't1', type: 'llm_failover', message: 'Failover to anthropic.' });

    expect(alerts.create).toHaveBeenCalledWith({
      tenantId: 't1',
      type: 'llm_failover',
      message: 'Failover to anthropic.',
    });
  });
});
