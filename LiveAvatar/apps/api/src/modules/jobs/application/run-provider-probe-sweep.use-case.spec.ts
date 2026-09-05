import type { ProbeStrategyPort, ProviderCredentialRepositoryPort } from '../../providers';
import type { ProviderCredentialRecord } from '../../providers';
import { RunProviderProbeSweepUseCase } from './run-provider-probe-sweep.use-case';

function credential(overrides: Partial<ProviderCredentialRecord> = {}): ProviderCredentialRecord {
  return {
    id: 'cred-1',
    tenantId: 'tenant-1',
    providerKey: 'openai',
    displayLabel: 'default',
    endpointUrl: 'https://api.openai.com',
    credentialRef: 'secrets/openai',
    extra: {},
    lastProbeStatus: 'unknown',
    lastProbeAt: null,
    lastProbeError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('RunProviderProbeSweepUseCase', () => {
  let credentials: jest.Mocked<ProviderCredentialRepositoryPort>;
  let strategy: jest.Mocked<ProbeStrategyPort>;
  let useCase: RunProviderProbeSweepUseCase;

  beforeEach(() => {
    credentials = {
      create: jest.fn(),
      findById: jest.fn(),
      findByLabel: jest.fn(),
      list: jest.fn(),
      listAllActive: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      recordProbeResult: jest.fn(),
    };
    strategy = { probe: jest.fn() };
    useCase = new RunProviderProbeSweepUseCase(credentials, strategy);
  });

  it('probes and records every active-tenant credential', async () => {
    credentials.listAllActive.mockResolvedValue([credential({ id: 'a' }), credential({ id: 'b' })]);
    strategy.probe.mockResolvedValue({ status: 'healthy' });

    const result = await useCase.execute();

    expect(result).toEqual({ probed: 2, failed: 0 });
    expect(credentials.recordProbeResult).toHaveBeenCalledTimes(2);
  });

  it('isolates one credential failure from the rest of the sweep', async () => {
    credentials.listAllActive.mockResolvedValue([credential({ id: 'a' }), credential({ id: 'b' })]);
    strategy.probe.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ status: 'healthy' });

    const result = await useCase.execute();

    expect(result).toEqual({ probed: 2, failed: 1 });
    expect(credentials.recordProbeResult).toHaveBeenCalledTimes(1);
  });

  it('handles zero active credentials', async () => {
    credentials.listAllActive.mockResolvedValue([]);
    const result = await useCase.execute();
    expect(result).toEqual({ probed: 0, failed: 0 });
  });
});
