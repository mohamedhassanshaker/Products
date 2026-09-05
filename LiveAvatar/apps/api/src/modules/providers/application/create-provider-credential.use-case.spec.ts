import type { TenantRepositoryPort } from '../../tenants';
import type { ProviderCredentialRepositoryPort, ProviderDefinitionRepositoryPort } from '../domain/ports';
import type { ProviderCredentialRecord, ProviderDefinitionRecord } from '../domain/provider';
import { CreateProviderCredentialUseCase } from './create-provider-credential.use-case';

function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tenant-1',
    name: 'Acme',
    slug: 'acme',
    status: 'active' as const,
    roomNamespace: 'acme',
    createdAt: new Date(),
    updatedAt: new Date(),
    providerStackSummary: 'Not configured',
    ...overrides,
  };
}

function makeDef(overrides: Partial<ProviderDefinitionRecord> = {}): ProviderDefinitionRecord {
  return {
    key: 'openai',
    category: 'llm',
    displayName: 'OpenAI',
    hosting: 'remote',
    interfaceName: 'ILLMProvider',
    requiresCredential: true,
    enabled: true,
    featureGaps: null,
    ...overrides,
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

describe('CreateProviderCredentialUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let definitions: jest.Mocked<ProviderDefinitionRepositoryPort>;
  let credentials: jest.Mocked<ProviderCredentialRepositoryPort>;
  let useCase: CreateProviderCredentialUseCase;
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
    definitions = {
      list: jest.fn(),
      findByKey: jest.fn(),
      countEnabledInCategory: jest.fn(),
      setEnabled: jest.fn(),
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
    useCase = new CreateProviderCredentialUseCase(tenants, definitions, credentials);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(
      useCase.execute(actor, 'tenant-1', { provider_key: 'openai', endpoint_url: 'https://api.openai.com' }),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('403s an admin not assigned to the tenant', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(
      useCase.execute(unassigned, 'tenant-1', { provider_key: 'openai', endpoint_url: 'https://api.openai.com' }),
    ).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN' });
  });

  it('404s an unknown provider key', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    definitions.findByKey.mockResolvedValue(null);
    await expect(
      useCase.execute(actor, 'tenant-1', { provider_key: 'bogus', endpoint_url: 'https://api.openai.com' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNKNOWN' });
  });

  it('rejects a non-https endpoint', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    definitions.findByKey.mockResolvedValue(makeDef());
    await expect(
      useCase.execute(actor, 'tenant-1', { provider_key: 'openai', endpoint_url: 'http://api.openai.com' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ENDPOINT_INVALID' });
  });

  it('rejects a raw secret in extra', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    definitions.findByKey.mockResolvedValue(makeDef());
    await expect(
      useCase.execute(actor, 'tenant-1', {
        provider_key: 'openai',
        endpoint_url: 'https://api.openai.com',
        extra: { api_key: 'sk-live-secret' },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_SECRET_IN_BODY' });
    expect(credentials.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate (tenant, provider, label)', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    definitions.findByKey.mockResolvedValue(makeDef());
    credentials.findByLabel.mockResolvedValue(makeCredential());
    await expect(
      useCase.execute(actor, 'tenant-1', { provider_key: 'openai', endpoint_url: 'https://api.openai.com' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_EXISTS', httpStatus: 409 });
  });

  it('creates a credential and never echoes a raw secret value, only credential_ref/has_secret', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    definitions.findByKey.mockResolvedValue(makeDef());
    credentials.findByLabel.mockResolvedValue(null);
    credentials.create.mockResolvedValue(makeCredential());

    const result = await useCase.execute(actor, 'tenant-1', {
      provider_key: 'openai',
      endpoint_url: 'https://api.openai.com',
      credential_ref: 'secrets/openai',
    });

    expect(result).toMatchObject({ credential_ref: 'secrets/openai', has_secret: true });
    expect(JSON.stringify(result)).not.toContain('sk-');
  });
});
