import type { TenantRepositoryPort } from '../../tenants';
import type { ProviderCredentialRepositoryPort } from '../domain/ports';
import type { ProviderCredentialRecord } from '../domain/provider';
import { UpdateProviderCredentialUseCase } from './update-provider-credential.use-case';

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
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('UpdateProviderCredentialUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let credentials: jest.Mocked<ProviderCredentialRepositoryPort>;
  let useCase: UpdateProviderCredentialUseCase;
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
    useCase = new UpdateProviderCredentialUseCase(tenants, credentials);
    tenants.findById.mockResolvedValue(makeTenant());
    credentials.findById.mockResolvedValue(makeCredential());
  });

  const ifMatch = '2026-01-01T00:00:00.000Z';

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(
      useCase.execute(actor, 'tenant-1', 'cred-1', { display_label: 'lab' }, ifMatch),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('403s an unassigned admin', async () => {
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other'] };
    await expect(
      useCase.execute(unassigned, 'tenant-1', 'cred-1', { display_label: 'lab' }, ifMatch),
    ).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN' });
  });

  it('404s an unknown credential', async () => {
    credentials.findById.mockResolvedValue(null);
    await expect(
      useCase.execute(actor, 'tenant-1', 'cred-1', { display_label: 'lab' }, ifMatch),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNKNOWN' });
  });

  it('patches credential_ref alone', async () => {
    credentials.update.mockResolvedValue(makeCredential({ credentialRef: 'secrets/new' }));
    const result = await useCase.execute(actor, 'tenant-1', 'cred-1', { credential_ref: 'secrets/new' }, ifMatch);
    expect(result.credential_ref).toBe('secrets/new');
    expect(credentials.update).toHaveBeenCalledWith(
      'tenant-1',
      'cred-1',
      { credentialRef: 'secrets/new' },
      new Date(ifMatch),
    );
  });

  it('404s when the update resolves missing (deleted mid-flight)', async () => {
    credentials.update.mockResolvedValue('missing');
    await expect(
      useCase.execute(actor, 'tenant-1', 'cred-1', { display_label: 'lab' }, ifMatch),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNKNOWN' });
  });

  it('rejects a non-https endpoint on patch', async () => {
    await expect(
      useCase.execute(actor, 'tenant-1', 'cred-1', { endpoint_url: 'http://evil.example.com' }, ifMatch),
    ).rejects.toMatchObject({ code: 'PROVIDER_ENDPOINT_INVALID' });
  });

  it('rejects a secret smuggled into extra on patch', async () => {
    await expect(
      useCase.execute(actor, 'tenant-1', 'cred-1', { extra: { token: 'shh' } }, ifMatch),
    ).rejects.toMatchObject({ code: 'PROVIDER_SECRET_IN_BODY' });
  });

  it('409s on a malformed If-Match', async () => {
    await expect(
      useCase.execute(actor, 'tenant-1', 'cred-1', { display_label: 'lab' }, 'not-a-date'),
    ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT', httpStatus: 409 });
  });

  it('409s on a stale If-Match (optimistic lock)', async () => {
    credentials.update.mockResolvedValue('conflict');
    await expect(
      useCase.execute(actor, 'tenant-1', 'cred-1', { display_label: 'lab' }, ifMatch),
    ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT', httpStatus: 409 });
  });

  it('updates and returns the new DTO', async () => {
    credentials.update.mockResolvedValue(makeCredential({ displayLabel: 'lab' }));
    const result = await useCase.execute(actor, 'tenant-1', 'cred-1', { display_label: 'lab' }, ifMatch);
    expect(result.display_label).toBe('lab');
  });
});
