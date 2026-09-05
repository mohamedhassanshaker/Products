import type { TenantRepositoryPort } from '../../tenants';
import type { DeploymentConfigRecord, DeploymentConfigRepositoryPort } from '../domain/ports';
import { GetConfigUseCase } from './get-config.use-case';

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

function makeConfig(overrides: Partial<DeploymentConfigRecord> = {}): DeploymentConfigRecord {
  return {
    id: 'config-1',
    tenantId: 'tenant-1',
    yamlText: '',
    status: 'draft',
    providers: { transport: null, stt: null, llm: null, llmFallback: null, tts: null, avatar: null },
    updatedAt: new Date(),
    updatedBy: null,
    publishedAt: null,
    structured: {},
    pendingRollbackFromVersionId: null,
    ...overrides,
  };
}

describe('GetConfigUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let configs: jest.Mocked<DeploymentConfigRepositoryPort>;
  let useCase: GetConfigUseCase;
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
    configs = { findByTenantId: jest.fn(), save: jest.fn() };
    useCase = new GetConfigUseCase(tenants, configs);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('404s (not 403) an unassigned admin', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other'] };
    await expect(useCase.execute(unassigned, 'tenant-1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('returns the config DTO', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    configs.findByTenantId.mockResolvedValue(makeConfig({ status: 'published' }));
    const result = await useCase.execute(actor, 'tenant-1');
    expect(result).toMatchObject({ id: 'config-1', status: 'published' });
  });
});
