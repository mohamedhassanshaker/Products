import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiNotConfiguredError } from '../domain/errors';
import type { ApprovedAiModelRepository } from '../infrastructure/approved-ai-model.repository';
import type { PlatformTenantRepository } from '@/server/platform/tenants';
import { AiModelResolver } from './ai-model-resolver';

/** Pure-logic unit tests (fake repositories, no real database) for `AiModelResolver`'s resolution
 * order/caching/invalidation rules — migration plan Phase 2 sub-slice "2b"'s own "Per-phase
 * verification" item 4. */

function createFakeTenantRepo(overrides: Partial<PlatformTenantRepository> = {}): PlatformTenantRepository {
  return { findById: vi.fn(async () => null), ...overrides } as unknown as PlatformTenantRepository;
}

function createFakeModelRepo(overrides: Partial<ApprovedAiModelRepository> = {}): ApprovedAiModelRepository {
  return { findById: vi.fn(async () => null), findPlatformDefault: vi.fn(async () => null), ...overrides } as unknown as ApprovedAiModelRepository;
}

const defaultModel = {
  id: 'm-default',
  openRouterModelId: 'anthropic/claude-3.5-haiku',
  displayName: 'Claude 3.5 Haiku',
  isEnabled: true,
  isPlatformDefault: true,
};

const assignedModel = {
  id: 'm-assigned',
  openRouterModelId: 'openai/gpt-4o-mini',
  displayName: 'GPT-4o mini',
  isEnabled: true,
  isPlatformDefault: false,
};

describe('AiModelResolver.resolve', () => {
  let resolver: AiModelResolver;

  afterEach(() => {
    resolver?.dispose();
  });

  it('resolves to the platform default when the tenant has no explicit assignment', async () => {
    const tenants = createFakeTenantRepo({ findById: vi.fn(async () => ({ assignedAiModelId: null }) as never) });
    const models = createFakeModelRepo({ findPlatformDefault: vi.fn(async () => ({ ...defaultModel }) as never) });
    resolver = new AiModelResolver(tenants, models);

    const result = await resolver.resolve('t1');
    expect(result.source).toBe('platform_default');
    expect(result.primary.openRouterModelId).toBe('anthropic/claude-3.5-haiku');
    expect(result.fallback).toBeUndefined();
  });

  it('resolves to the explicit assignment, even if it differs from the platform default, with a fallback candidate', async () => {
    const tenants = createFakeTenantRepo({ findById: vi.fn(async () => ({ assignedAiModelId: 'm-assigned' }) as never) });
    const models = createFakeModelRepo({
      findById: vi.fn(async () => ({ ...assignedModel }) as never),
      findPlatformDefault: vi.fn(async () => ({ ...defaultModel }) as never),
    });
    resolver = new AiModelResolver(tenants, models);

    const result = await resolver.resolve('t1');
    expect(result.source).toBe('assigned');
    expect(result.primary.openRouterModelId).toBe('openai/gpt-4o-mini');
    expect(result.fallback?.openRouterModelId).toBe('anthropic/claude-3.5-haiku');
  });

  it('resolves the explicit assignment even when it is currently disabled (disabling must never break an already-configured tenant)', async () => {
    const tenants = createFakeTenantRepo({ findById: vi.fn(async () => ({ assignedAiModelId: 'm-assigned' }) as never) });
    const models = createFakeModelRepo({
      findById: vi.fn(async () => ({ ...assignedModel, isEnabled: false }) as never),
      findPlatformDefault: vi.fn(async () => ({ ...defaultModel }) as never),
    });
    resolver = new AiModelResolver(tenants, models);

    const result = await resolver.resolve('t1');
    expect(result.source).toBe('assigned');
    expect(result.primary.openRouterModelId).toBe('openai/gpt-4o-mini');
  });

  it('never emits a redundant fallback identical to primary', async () => {
    const tenants = createFakeTenantRepo({ findById: vi.fn(async () => ({ assignedAiModelId: 'm-default' }) as never) });
    const models = createFakeModelRepo({
      findById: vi.fn(async () => ({ ...defaultModel }) as never),
      findPlatformDefault: vi.fn(async () => ({ ...defaultModel }) as never),
    });
    resolver = new AiModelResolver(tenants, models);

    const result = await resolver.resolve('t1');
    expect(result.fallback).toBeUndefined();
  });

  it('throws AiNotConfiguredError when the allowlist is empty and no explicit assignment exists', async () => {
    const tenants = createFakeTenantRepo({ findById: vi.fn(async () => ({ assignedAiModelId: null }) as never) });
    const models = createFakeModelRepo();
    resolver = new AiModelResolver(tenants, models);

    await expect(resolver.resolve('t1')).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it('caches a resolution and does not re-query on a second call for the same tenant', async () => {
    const findByIdSpy = vi.fn(async () => ({ assignedAiModelId: null }) as never);
    const tenants = createFakeTenantRepo({ findById: findByIdSpy });
    const models = createFakeModelRepo({ findPlatformDefault: vi.fn(async () => ({ ...defaultModel }) as never) });
    resolver = new AiModelResolver(tenants, models);

    await resolver.resolve('t1');
    await resolver.resolve('t1');
    expect(findByIdSpy).toHaveBeenCalledTimes(1);
  });

  it('invalidate(tenantId) drops only that tenant\'s cache entry', async () => {
    const tenants = createFakeTenantRepo({ findById: vi.fn(async () => ({ assignedAiModelId: null }) as never) });
    const models = createFakeModelRepo({ findPlatformDefault: vi.fn(async () => ({ ...defaultModel }) as never) });
    resolver = new AiModelResolver(tenants, models);

    await resolver.resolve('t1');
    resolver.invalidate('t1');
    await resolver.resolve('t1');
    expect(tenants.findById).toHaveBeenCalledTimes(2);
  });

  it('invalidate() (no argument) clears every cached tenant', async () => {
    const tenants = createFakeTenantRepo({ findById: vi.fn(async () => ({ assignedAiModelId: null }) as never) });
    const models = createFakeModelRepo({ findPlatformDefault: vi.fn(async () => ({ ...defaultModel }) as never) });
    resolver = new AiModelResolver(tenants, models);

    await resolver.resolve('t1');
    await resolver.resolve('t2');
    resolver.invalidate();
    await resolver.resolve('t1');
    await resolver.resolve('t2');
    expect(tenants.findById).toHaveBeenCalledTimes(4);
  });
});
