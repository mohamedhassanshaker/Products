import type { TenantRepositoryPort } from '../../tenants';
import type { ProviderCredentialRepositoryPort, PublishedConfigLookupPort } from '../domain/ports';
import type { ProviderCredentialRecord } from '../domain/provider';
import { DeleteProviderCredentialUseCase } from './delete-provider-credential.use-case';

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

describe('DeleteProviderCredentialUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let credentials: jest.Mocked<ProviderCredentialRepositoryPort>;
  let publishedConfigs: jest.Mocked<PublishedConfigLookupPort>;
  let useCase: DeleteProviderCredentialUseCase;
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
    publishedConfigs = { isProviderInUse: jest.fn() };
    useCase = new DeleteProviderCredentialUseCase(tenants, credentials, publishedConfigs);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'cred-1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('403s an unassigned admin', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other'] };
    await expect(useCase.execute(unassigned, 'tenant-1', 'cred-1')).rejects.toMatchObject({
      code: 'TENANT_FORBIDDEN',
    });
  });

  it('404s an unknown credential', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    credentials.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'cred-1')).rejects.toMatchObject({ code: 'PROVIDER_UNKNOWN' });
  });

  it('404s when delete resolves false (deleted mid-flight)', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    credentials.findById.mockResolvedValue(makeCredential());
    publishedConfigs.isProviderInUse.mockResolvedValue(false);
    credentials.delete.mockResolvedValue(false);
    await expect(useCase.execute(actor, 'tenant-1', 'cred-1')).rejects.toMatchObject({ code: 'PROVIDER_UNKNOWN' });
  });

  it('blocks deleting a credential a published config depends on', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    credentials.findById.mockResolvedValue(makeCredential());
    publishedConfigs.isProviderInUse.mockResolvedValue(true);
    await expect(useCase.execute(actor, 'tenant-1', 'cred-1')).rejects.toMatchObject({
      code: 'CONFIG_CREDENTIAL_MISSING',
      httpStatus: 422,
    });
    expect(credentials.delete).not.toHaveBeenCalled();
  });

  it('deletes when no published config depends on it', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    credentials.findById.mockResolvedValue(makeCredential());
    publishedConfigs.isProviderInUse.mockResolvedValue(false);
    credentials.delete.mockResolvedValue(true);
    await useCase.execute(actor, 'tenant-1', 'cred-1');
    expect(credentials.delete).toHaveBeenCalledWith('tenant-1', 'cred-1');
  });
});
