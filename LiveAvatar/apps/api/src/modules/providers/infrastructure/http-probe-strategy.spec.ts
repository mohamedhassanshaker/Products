import { HttpProbeStrategy } from './http-probe-strategy';
import type { ProviderCredentialRecord } from '../domain/provider';

function makeCredential(overrides: Partial<ProviderCredentialRecord> = {}): ProviderCredentialRecord {
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

describe('HttpProbeStrategy', () => {
  const strategy = new HttpProbeStrategy();
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('classifies a 2xx response as healthy', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 200 }) as unknown as typeof fetch;
    const result = await strategy.probe(makeCredential());
    expect(result).toEqual({ status: 'healthy' });
  });

  it('classifies a 401 as healthy (proves reachability)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 401 }) as unknown as typeof fetch;
    const result = await strategy.probe(makeCredential());
    expect(result.status).toBe('healthy');
  });

  it('classifies a 5xx response as degraded', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 503 }) as unknown as typeof fetch;
    const result = await strategy.probe(makeCredential());
    expect(result.status).toBe('degraded');
  });

  it('classifies a 404 as unreachable', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 404 }) as unknown as typeof fetch;
    const result = await strategy.probe(makeCredential());
    expect(result.status).toBe('unreachable');
    expect(result.errorCode).toBe('PROVIDER_UNREACHABLE');
  });

  it('classifies a network failure as unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const result = await strategy.probe(makeCredential());
    expect(result.status).toBe('unreachable');
    expect(result.message).toContain('Could not reach');
  });
});
