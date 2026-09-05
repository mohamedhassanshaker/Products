import type { TenantRepositoryPort } from '../../tenants';
import type {
  ProbeRateLimiterPort,
  ProbeStrategyPort,
  ProviderCredentialRepositoryPort,
} from '../domain/ports';
import type { ProviderCredentialRecord } from '../domain/provider';
import { ProbeProviderCredentialUseCase } from './probe-provider-credential.use-case';

function makeTenant() {
  return {
    id: 'tenant-1',
    name: 'Acme',
    slug: 'acme',
    status: 'active' as const,
    roomNamespace: 'acme',
    createdAt: new Date(),
    updatedAt: new Date(),
    providerStackSummary: 'Not configured',
  };
}

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

describe('ProbeProviderCredentialUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let credentials: jest.Mocked<ProviderCredentialRepositoryPort>;
  let strategy: jest.Mocked<ProbeStrategyPort>;
  let rateLimiter: jest.Mocked<ProbeRateLimiterPort>;
  let useCase: ProbeProviderCredentialUseCase;
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

  beforeEach(() => {
    tenants = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      count: jest.fn(),
      list: jest.fn(),
      updateName: jest.fn(),
      updateStatus: jest.fn(),
    };
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
    rateLimiter = { tryConsume: jest.fn() };
    useCase = new ProbeProviderCredentialUseCase(tenants, credentials, strategy, rateLimiter);
    tenants.findById.mockResolvedValue(makeTenant());
    credentials.findById.mockResolvedValue(makeCredential());
    rateLimiter.tryConsume.mockResolvedValue(true);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'cred-1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('403s an unassigned admin', async () => {
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other'] };
    await expect(useCase.execute(unassigned, 'tenant-1', 'cred-1')).rejects.toMatchObject({
      code: 'TENANT_FORBIDDEN',
    });
  });

  it('404s an unknown credential', async () => {
    credentials.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'cred-1')).rejects.toMatchObject({ code: 'PROVIDER_UNKNOWN' });
  });

  it('429s when the rate limit is exhausted', async () => {
    rateLimiter.tryConsume.mockResolvedValue(false);
    await expect(useCase.execute(actor, 'tenant-1', 'cred-1')).rejects.toMatchObject({
      code: 'PROVIDER_PROBE_RATE_LIMITED',
      httpStatus: 429,
    });
    expect(strategy.probe).not.toHaveBeenCalled();
  });

  it('returns 200 with status unreachable rather than throwing (FR-PROVIDER-3)', async () => {
    strategy.probe.mockResolvedValue({
      status: 'unreachable',
      errorCode: 'PROVIDER_UNREACHABLE',
      message: 'Could not reach default at https://api.openai.com.',
    });
    const result = await useCase.execute(actor, 'tenant-1', 'cred-1');
    expect(result.status).toBe('unreachable');
    expect(credentials.recordProbeResult).toHaveBeenCalledWith(
      'tenant-1',
      'cred-1',
      expect.objectContaining({ status: 'unreachable' }),
    );
  });

  it('stores a healthy probe result', async () => {
    strategy.probe.mockResolvedValue({ status: 'healthy' });
    const result = await useCase.execute(actor, 'tenant-1', 'cred-1');
    expect(result.status).toBe('healthy');
    expect(credentials.recordProbeResult).toHaveBeenCalledWith(
      'tenant-1',
      'cred-1',
      expect.objectContaining({ status: 'healthy', error: null }),
    );
  });
});
