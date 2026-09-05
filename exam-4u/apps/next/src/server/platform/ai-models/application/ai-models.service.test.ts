import { describe, expect, it, vi } from 'vitest';
import type { PlatformTenantRepository } from '@/server/platform/tenants';
import {
  DefaultModelRequiredError,
  InvalidModelIdError,
  ModelAlreadyApprovedError,
  ModelDisabledError,
  ModelNotApprovedError,
  ModelNotFoundError,
} from '../domain/errors';
import type { ApprovedAiModelRepository } from '../infrastructure/approved-ai-model.repository';
import type { AiModelResolver } from './ai-model-resolver';
import { AiModelsService } from './ai-models.service';

/** Pure-logic unit tests (fake repositories/resolver, no real database) for `AiModelsService` —
 * migration plan Phase 2 sub-slice "2b"'s own "Per-phase verification" item 4. */

function createFakeModelRepo(overrides: Partial<ApprovedAiModelRepository> = {}): ApprovedAiModelRepository {
  const base: Partial<ApprovedAiModelRepository> = {
    findById: vi.fn(async () => null),
    findByOpenRouterModelId: vi.fn(async () => null),
    findAll: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    insert: vi.fn(async (input) => ({ id: 'm1', isEnabled: true, ...input, createdAt: new Date(), updatedAt: new Date() }) as never),
    save: vi.fn(async (entity) => entity as never),
    setDefault: vi.fn(async (id) => ({ id, isPlatformDefault: true }) as never),
    remove: vi.fn(async () => undefined),
    countTenantsAssigned: vi.fn(async () => 0),
    ...overrides,
  };
  return base as ApprovedAiModelRepository;
}

function createFakeTenantRepo(overrides: Partial<PlatformTenantRepository> = {}): PlatformTenantRepository {
  return { setAssignedAiModel: vi.fn(async () => undefined), ...overrides } as unknown as PlatformTenantRepository;
}

function createFakeResolver(overrides: Partial<AiModelResolver> = {}): AiModelResolver {
  return {
    invalidate: vi.fn(),
    resolve: vi.fn(async () => ({ source: 'platform_default', primary: { openRouterModelId: 'anthropic/claude-3.5-haiku', displayName: 'Claude' } })),
    ...overrides,
  } as unknown as AiModelResolver;
}

const baseRow = {
  id: 'm1',
  openRouterModelId: 'anthropic/claude-3.5-haiku',
  displayName: 'Claude',
  isEnabled: true,
  isPlatformDefault: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AiModelsService.approve', () => {
  it('rejects a malformed OpenRouter model id', async () => {
    const service = new AiModelsService(createFakeModelRepo(), createFakeTenantRepo(), createFakeResolver());
    await expect(service.approve({ openRouterModelId: 'not-a-valid-id', displayName: 'x' })).rejects.toBeInstanceOf(InvalidModelIdError);
  });

  it('rejects a blank model id', async () => {
    const service = new AiModelsService(createFakeModelRepo(), createFakeTenantRepo(), createFakeResolver());
    await expect(service.approve({ openRouterModelId: '   ', displayName: 'x' })).rejects.toBeInstanceOf(InvalidModelIdError);
  });

  it('rejects an already-approved model id', async () => {
    const models = createFakeModelRepo({ findByOpenRouterModelId: vi.fn(async () => ({ ...baseRow }) as never) });
    const service = new AiModelsService(models, createFakeTenantRepo(), createFakeResolver());
    await expect(service.approve({ openRouterModelId: 'anthropic/claude-3.5-haiku', displayName: 'x' })).rejects.toBeInstanceOf(
      ModelAlreadyApprovedError,
    );
  });

  it('the first-ever approval auto-becomes the platform default', async () => {
    const models = createFakeModelRepo({ count: vi.fn(async () => 0) });
    const resolver = createFakeResolver();
    const service = new AiModelsService(models, createFakeTenantRepo(), resolver);
    await service.approve({ openRouterModelId: 'anthropic/claude-3.5-haiku', displayName: 'Claude' });
    expect(models.insert).toHaveBeenCalledWith(expect.objectContaining({ makeDefault: true }));
    expect(resolver.invalidate).toHaveBeenCalled();
  });

  it('a subsequent approval does not auto-become the default', async () => {
    const models = createFakeModelRepo({ count: vi.fn(async () => 1) });
    const service = new AiModelsService(models, createFakeTenantRepo(), createFakeResolver());
    await service.approve({ openRouterModelId: 'openai/gpt-4o-mini', displayName: 'GPT-4o mini' });
    expect(models.insert).toHaveBeenCalledWith(expect.objectContaining({ makeDefault: false }));
  });

  it('accepts a model id with a :variant suffix', async () => {
    const models = createFakeModelRepo();
    const service = new AiModelsService(models, createFakeTenantRepo(), createFakeResolver());
    await expect(service.approve({ openRouterModelId: 'openai/gpt-4o-mini:free', displayName: 'x' })).resolves.toBeDefined();
  });
});

describe('AiModelsService.get', () => {
  it('throws ModelNotFoundError for an unknown id', async () => {
    const service = new AiModelsService(createFakeModelRepo(), createFakeTenantRepo(), createFakeResolver());
    await expect(service.get('missing')).rejects.toBeInstanceOf(ModelNotFoundError);
  });
});

describe('AiModelsService.update', () => {
  it('throws ModelNotFoundError for an unknown id', async () => {
    const service = new AiModelsService(createFakeModelRepo(), createFakeTenantRepo(), createFakeResolver());
    await expect(service.update('missing', { displayName: 'x' })).rejects.toBeInstanceOf(ModelNotFoundError);
  });

  it('rejects disabling the current platform default (DEFAULT_MODEL_REQUIRED)', async () => {
    const models = createFakeModelRepo({ findById: vi.fn(async () => ({ ...baseRow, isPlatformDefault: true }) as never) });
    const service = new AiModelsService(models, createFakeTenantRepo(), createFakeResolver());
    await expect(service.update('m1', { isEnabled: false })).rejects.toBeInstanceOf(DefaultModelRequiredError);
  });

  it('invalidates the resolver cache only when isEnabled is actually touched', async () => {
    const models = createFakeModelRepo({ findById: vi.fn(async () => ({ ...baseRow }) as never) });
    const resolver = createFakeResolver();
    const service = new AiModelsService(models, createFakeTenantRepo(), resolver);
    await service.update('m1', { displayName: 'Renamed only' });
    expect(resolver.invalidate).not.toHaveBeenCalled();

    await service.update('m1', { isEnabled: false });
    expect(resolver.invalidate).toHaveBeenCalled();
  });
});

describe('AiModelsService.setDefault', () => {
  it('throws ModelNotFoundError for an unknown id', async () => {
    const service = new AiModelsService(createFakeModelRepo(), createFakeTenantRepo(), createFakeResolver());
    await expect(service.setDefault('missing')).rejects.toBeInstanceOf(ModelNotFoundError);
  });

  it('refuses to make a disabled model the default (MODEL_DISABLED)', async () => {
    const models = createFakeModelRepo({ findById: vi.fn(async () => ({ ...baseRow, isEnabled: false }) as never) });
    const service = new AiModelsService(models, createFakeTenantRepo(), createFakeResolver());
    await expect(service.setDefault('m1')).rejects.toBeInstanceOf(ModelDisabledError);
  });

  it('sets the default and invalidates the whole resolver cache', async () => {
    const models = createFakeModelRepo({ findById: vi.fn(async () => ({ ...baseRow }) as never) });
    const resolver = createFakeResolver();
    const service = new AiModelsService(models, createFakeTenantRepo(), resolver);
    await service.setDefault('m1');
    expect(models.setDefault).toHaveBeenCalledWith('m1');
    expect(resolver.invalidate).toHaveBeenCalledWith();
  });
});

describe('AiModelsService.remove', () => {
  it('throws ModelNotFoundError for an unknown id', async () => {
    const service = new AiModelsService(createFakeModelRepo(), createFakeTenantRepo(), createFakeResolver());
    await expect(service.remove('missing')).rejects.toBeInstanceOf(ModelNotFoundError);
  });

  it('refuses to remove the current platform default (DEFAULT_MODEL_REQUIRED)', async () => {
    const models = createFakeModelRepo({ findById: vi.fn(async () => ({ ...baseRow, isPlatformDefault: true }) as never) });
    const service = new AiModelsService(models, createFakeTenantRepo(), createFakeResolver());
    await expect(service.remove('m1')).rejects.toBeInstanceOf(DefaultModelRequiredError);
  });

  it('refuses to remove a model still assigned to a tenant, naming the exact count (MODEL_IN_USE)', async () => {
    const models = createFakeModelRepo({
      findById: vi.fn(async () => ({ ...baseRow }) as never),
      countTenantsAssigned: vi.fn(async () => 3),
    });
    const service = new AiModelsService(models, createFakeTenantRepo(), createFakeResolver());
    await expect(service.remove('m1')).rejects.toMatchObject({ code: 'MODEL_IN_USE', details: { tenantCount: 3 } });
    expect(models.remove).not.toHaveBeenCalled();
  });

  it('removes an unreferenced, non-default model', async () => {
    const models = createFakeModelRepo({ findById: vi.fn(async () => ({ ...baseRow }) as never) });
    const resolver = createFakeResolver();
    const service = new AiModelsService(models, createFakeTenantRepo(), resolver);
    await service.remove('m1');
    expect(models.remove).toHaveBeenCalledWith('m1');
    expect(resolver.invalidate).toHaveBeenCalled();
  });
});

describe('AiModelsService.assignToTenant / unassignFromTenant', () => {
  it('rejects assigning a model that is not on the allowlist at all', async () => {
    const service = new AiModelsService(createFakeModelRepo(), createFakeTenantRepo(), createFakeResolver());
    await expect(service.assignToTenant('t1', 'missing')).rejects.toBeInstanceOf(ModelNotApprovedError);
  });

  it('rejects assigning a currently-disabled model (does not enumerate which)', async () => {
    const models = createFakeModelRepo({ findById: vi.fn(async () => ({ ...baseRow, isEnabled: false }) as never) });
    const service = new AiModelsService(models, createFakeTenantRepo(), createFakeResolver());
    await expect(service.assignToTenant('t1', 'm1')).rejects.toBeInstanceOf(ModelNotApprovedError);
  });

  it('assigns an enabled, approved model and invalidates only that tenant', async () => {
    const models = createFakeModelRepo({ findById: vi.fn(async () => ({ ...baseRow }) as never) });
    const tenants = createFakeTenantRepo();
    const resolver = createFakeResolver();
    const service = new AiModelsService(models, tenants, resolver);
    await service.assignToTenant('t1', 'm1');
    expect(tenants.setAssignedAiModel).toHaveBeenCalledWith('t1', 'm1');
    expect(resolver.invalidate).toHaveBeenCalledWith('t1');
  });

  it('unassign is idempotent and always succeeds', async () => {
    const tenants = createFakeTenantRepo();
    const resolver = createFakeResolver();
    const service = new AiModelsService(createFakeModelRepo(), tenants, resolver);
    await service.unassignFromTenant('t1');
    expect(tenants.setAssignedAiModel).toHaveBeenCalledWith('t1', null);
    expect(resolver.invalidate).toHaveBeenCalledWith('t1');
  });
});

describe('AiModelsService.resolveEffectiveModel', () => {
  it('delegates to the resolver and reshapes its result', async () => {
    const resolver = createFakeResolver();
    const service = new AiModelsService(createFakeModelRepo(), createFakeTenantRepo(), resolver);
    const result = await service.resolveEffectiveModel('t1');
    expect(result).toEqual({ source: 'platform_default', openRouterModelId: 'anthropic/claude-3.5-haiku', displayName: 'Claude' });
  });
});
