import type { TenantRepositoryPort } from '../../tenants';
import type { ConfigVersionRepositoryPort, DeploymentConfigRecord, DeploymentConfigRepositoryPort } from '../domain/ports';
import { RollbackConfigVersionUseCase } from './rollback-config-version.use-case';

const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

function makeTenant(overrides: Record<string, unknown> = {}) {
  return { id: 'tenant-1', name: 'Acme', slug: 'acme', ...overrides };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-old',
    tenantId: 'tenant-1',
    versionNumber: 3,
    yamlText: 'version: 1\ntransport:\n  provider: livekit\n',
    status: 'published' as const,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: 'admin-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    rolledBackFrom: null,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<DeploymentConfigRecord> = {}): DeploymentConfigRecord {
  return {
    id: 'config-1',
    tenantId: 'tenant-1',
    yamlText: 'version: 1',
    status: 'draft',
    providers: { transport: null, stt: null, llm: null, llmFallback: null, tts: null, avatar: null },
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedBy: null,
    publishedAt: null,
    structured: {},
    pendingRollbackFromVersionId: null,
    ...overrides,
  };
}

describe('RollbackConfigVersionUseCase', () => {
  function make(tenant: unknown = makeTenant(), version: unknown = makeVersion(), current: unknown = makeConfig()) {
    const tenants = { findById: jest.fn().mockResolvedValue(tenant) } as unknown as jest.Mocked<TenantRepositoryPort>;
    const configs = {
      findByTenantId: jest.fn().mockResolvedValue(current),
      save: jest.fn(),
    } as unknown as jest.Mocked<DeploymentConfigRepositoryPort>;
    const versionsRepo = {
      findByTenantAndVersion: jest.fn().mockResolvedValue(version),
      markRolledBack: jest.fn(),
    } as unknown as jest.Mocked<ConfigVersionRepositoryPort>;
    const useCase = new RollbackConfigVersionUseCase(tenants, configs, versionsRepo);
    return { useCase, tenants, configs, versionsRepo };
  }

  it('404s an unknown tenant', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute(actor, 'tenant-1', 3)).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('404s (not 403) an admin not assigned to this tenant', async () => {
    const { useCase } = make(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(useCase.execute(unassigned, 'tenant-1', 3)).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('404s CONFIG_VERSION_NOT_FOUND when the target version does not exist', async () => {
    const { useCase } = make(makeTenant(), null);
    await expect(useCase.execute(actor, 'tenant-1', 99)).rejects.toMatchObject({ code: 'CONFIG_VERSION_NOT_FOUND' });
  });

  it('404s TENANT_NOT_FOUND (defensive) when the tenant has no DeploymentConfig row at all', async () => {
    const { useCase } = make(makeTenant(), makeVersion(), null);
    await expect(useCase.execute(actor, 'tenant-1', 3)).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('creates a new draft prefilled from the target version\'s yamlText, never auto-publishing', async () => {
    const { useCase, configs } = make();
    configs.save.mockResolvedValue(makeConfig());
    await useCase.execute(actor, 'tenant-1', 3);
    expect(configs.save).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        yamlText: 'version: 1\ntransport:\n  provider: livekit\n',
        status: 'draft',
        pendingRollbackFromVersionId: 'version-old',
      }),
      expect.any(Date),
    );
  });

  it('derives denormalized providers from the target version\'s yaml (including the first llm-type graph node)', async () => {
    const version = makeVersion({
      yamlText: [
        'version: 1',
        'transport:',
        '  provider: livekit',
        'reasoning:',
        '  entry_node_id: llm-1',
        '  background_entry_node_ids: []',
        '  turn_budget_ms: 3000',
        '  graph:',
        '    - id: llm-1',
        '      type: llm',
        '      name: Answer',
        '      lane: foreground',
        '      on_error:',
        '        action: degrade',
        '      on_deadline:',
        '        action: degrade',
        '      provider: openai',
        '      model: gpt-4o',
        '      retry:',
        '        max_attempts: 3',
        '        backoff_ms: [200, 400, 800]',
        '      next_node_id: null',
        '      fallback:',
        '        provider: anthropic',
        '        model: claude-3-5-sonnet',
        '',
      ].join('\n'),
    });
    const { useCase, configs } = make(makeTenant(), version);
    configs.save.mockResolvedValue(makeConfig());
    await useCase.execute(actor, 'tenant-1', 3);
    expect(configs.save).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        providers: expect.objectContaining({ transport: 'livekit', llm: 'openai', llmFallback: 'anthropic' }),
      }),
      expect.any(Date),
    );
  });

  it('marks the target version rolled_back after a successful save', async () => {
    const { useCase, configs, versionsRepo } = make();
    configs.save.mockResolvedValue(makeConfig());
    await useCase.execute(actor, 'tenant-1', 3);
    expect(versionsRepo.markRolledBack).toHaveBeenCalledWith('tenant-1', 3);
  });

  it('does not mark the version rolled_back when the save conflicts', async () => {
    const { useCase, configs, versionsRepo } = make();
    configs.save.mockResolvedValue('conflict');
    await expect(useCase.execute(actor, 'tenant-1', 3)).rejects.toMatchObject({ code: 'CONFIG_CONFLICT', httpStatus: 409 });
    expect(versionsRepo.markRolledBack).not.toHaveBeenCalled();
  });

  it('404s TENANT_NOT_FOUND when the save reports missing', async () => {
    const { useCase, configs } = make();
    configs.save.mockResolvedValue('missing');
    await expect(useCase.execute(actor, 'tenant-1', 3)).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('returns the new draft config DTO', async () => {
    const { useCase, configs } = make();
    configs.save.mockResolvedValue(makeConfig({ status: 'draft' }));
    const result = await useCase.execute(actor, 'tenant-1', 3);
    expect(result.config).toMatchObject({ status: 'draft' });
  });
});
