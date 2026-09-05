import type { TenantRepositoryPort } from '../../tenants';
import type { ProviderCredentialRepositoryPort } from '../domain/ports';
import { ListProviderCredentialsUseCase } from './list-provider-credentials.use-case';

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

describe('ListProviderCredentialsUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let credentials: jest.Mocked<ProviderCredentialRepositoryPort>;
  let useCase: ListProviderCredentialsUseCase;
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
    useCase = new ListProviderCredentialsUseCase(tenants, credentials);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', {})).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('404s (not 403) an admin unassigned to the tenant — cross-tenant rule', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other'] };
    await expect(useCase.execute(unassigned, 'tenant-1', {})).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('lists credentials never leaking a raw secret', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    credentials.list.mockResolvedValue([
      {
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
      },
    ]);
    const result = await useCase.execute(actor, 'tenant-1', {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ credential_ref: 'secrets/openai', has_secret: true });
  });
});
