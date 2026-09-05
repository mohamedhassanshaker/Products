import { describe, expect, it, vi } from 'vitest';
import {
  InvalidSubdomainError,
  InvalidTenantStateError,
  SubdomainTakenError,
  TenantNameRequiredError,
  TenantNotFoundError,
} from '../domain/errors';
import type { PlatformTenantRepository } from '../infrastructure/tenant.repository';
import { TenantsService } from './tenants.service';

/** Pure-logic unit tests (fake repository, no real database) for `TenantsService`'s validation rules
 * and lifecycle state-machine guards — migration plan's "Per-phase verification" item 4. */

function createFakeRepo(overrides: Partial<PlatformTenantRepository> = {}): PlatformTenantRepository {
  const base: Partial<PlatformTenantRepository> = {
    existsBySlug: vi.fn(async () => false),
    insert: vi.fn(async (data) => ({ ...data }) as never),
    findById: vi.fn(async () => null),
    save: vi.fn(async (entity) => entity as never),
    ...overrides,
  };
  return base as PlatformTenantRepository;
}

describe('TenantsService.create', () => {
  it('rejects an empty tenant name', async () => {
    const service = new TenantsService(createFakeRepo());
    await expect(service.create({ name: '   ', subdomainSlug: 'acme' })).rejects.toBeInstanceOf(TenantNameRequiredError);
  });

  it('rejects a malformed subdomain slug', async () => {
    const service = new TenantsService(createFakeRepo());
    await expect(service.create({ name: 'Acme', subdomainSlug: '-bad-' })).rejects.toBeInstanceOf(InvalidSubdomainError);
  });

  it('rejects a reserved subdomain', async () => {
    const service = new TenantsService(createFakeRepo());
    await expect(service.create({ name: 'Acme', subdomainSlug: 'admin' })).rejects.toBeInstanceOf(InvalidSubdomainError);
  });

  it('lowercases and trims the slug before validating (case-insensitive convenience)', async () => {
    const repo = createFakeRepo();
    const service = new TenantsService(repo);
    await service.create({ name: 'Acme', subdomainSlug: '  Acme-Corp  ' });
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ subdomainSlug: 'acme-corp' }));
  });

  it('rejects an already-taken subdomain', async () => {
    const repo = createFakeRepo({ existsBySlug: vi.fn(async () => true) });
    const service = new TenantsService(repo);
    await expect(service.create({ name: 'Acme', subdomainSlug: 'acme' })).rejects.toBeInstanceOf(SubdomainTakenError);
  });

  it('generates a schema name and persists the tenant in Provisioning status', async () => {
    const repo = createFakeRepo();
    const service = new TenantsService(repo);
    const result = await service.create({ name: 'Acme', subdomainSlug: 'acme' });
    expect(result.status).toBe('Provisioning');
    expect(result.schemaName).toMatch(/^t_acme_[0-9a-f]{8}$/);
  });
});

describe('TenantsService.get', () => {
  it('throws TenantNotFoundError for an unknown id', async () => {
    const service = new TenantsService(createFakeRepo({ findById: vi.fn(async () => null) }));
    await expect(service.get('missing')).rejects.toBeInstanceOf(TenantNotFoundError);
  });
});

describe('TenantsService lifecycle transitions', () => {
  const activeRow = {
    id: 't1',
    name: 'Acme',
    subdomainSlug: 'acme',
    schemaName: 't_acme_deadbeef',
    status: 'Active' as const,
    isDefault: false,
    allowEmailRegistration: true,
    allowGoogleSignIn: false,
    defaultSelfRegisterRole: null,
    logoUrl: null,
    accentColorOverride: null,
    provisioningError: null,
    provisioningHeartbeatAt: null,
    pendingAdminEmail: null,
    assignedAiModelId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    purgeAfterAt: null,
  };

  it('suspend() transitions Active -> Suspended', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...activeRow }) as never) });
    const service = new TenantsService(repo);
    const result = await service.suspend('t1');
    expect(result.status).toBe('Suspended');
  });

  it('suspend() rejects a non-Active tenant', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...activeRow, status: 'Suspended' }) as never) });
    const service = new TenantsService(repo);
    await expect(service.suspend('t1')).rejects.toBeInstanceOf(InvalidTenantStateError);
  });

  it('reactivate() transitions Suspended -> Active', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...activeRow, status: 'Suspended' }) as never) });
    const service = new TenantsService(repo);
    const result = await service.reactivate('t1');
    expect(result.status).toBe('Active');
  });

  it('softDelete() stamps deletedAt/purgeAfterAt and rejects an already-deleted tenant', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...activeRow }) as never) });
    const service = new TenantsService(repo);
    const result = await service.softDelete('t1');
    expect(result.deletedAt).not.toBeNull();
    expect(result.purgeAfterAt).not.toBeNull();

    const repoAlreadyDeleted = createFakeRepo({
      findById: vi.fn(async () => ({ ...activeRow, deletedAt: new Date() }) as never),
    });
    await expect(new TenantsService(repoAlreadyDeleted).softDelete('t1')).rejects.toBeInstanceOf(TenantNotFoundError);
  });
});

describe('TenantsService.getBranding / updateBranding (FR-MT-10, Phase 9 sub-slice "9a")', () => {
  const brandedRow = {
    id: 't1',
    name: 'Acme',
    subdomainSlug: 'acme',
    schemaName: 't_acme_deadbeef',
    status: 'Active' as const,
    isDefault: false,
    allowEmailRegistration: true,
    allowGoogleSignIn: false,
    defaultSelfRegisterRole: null,
    logoUrl: null,
    accentColorOverride: null,
    provisioningError: null,
    provisioningHeartbeatAt: null,
    pendingAdminEmail: null,
    assignedAiModelId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    purgeAfterAt: null,
  };

  it('getBranding() throws TenantNotFoundError for an unknown id', async () => {
    const service = new TenantsService(createFakeRepo({ findById: vi.fn(async () => null) }));
    await expect(service.getBranding('missing')).rejects.toBeInstanceOf(TenantNotFoundError);
  });

  it('getBranding() falls back to the platform default accent when no override is set', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...brandedRow }) as never) });
    const service = new TenantsService(repo);
    const branding = await service.getBranding('t1');
    expect(branding.accentColorOverride).toBeNull();
    expect(branding.effectiveAccentColor).toBe('5C6BC0'); // THEME_DEFAULT_ACCENT_COLOR's own default.
  });

  it('getBranding() reports an existing override as the effective color', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...brandedRow, accentColorOverride: '112233' }) as never) });
    const service = new TenantsService(repo);
    const branding = await service.getBranding('t1');
    expect(branding.effectiveAccentColor).toBe('112233');
  });

  it('updateBranding() throws TenantNotFoundError for an unknown id', async () => {
    const service = new TenantsService(createFakeRepo({ findById: vi.fn(async () => null) }));
    await expect(service.updateBranding('missing', { logoUrl: null })).rejects.toBeInstanceOf(TenantNotFoundError);
  });

  it('updateBranding() validates and normalizes a well-formed accent hex via color-contrast.ts', async () => {
    const repo = createFakeRepo({
      findById: vi.fn(async () => ({ ...brandedRow }) as never),
      save: vi.fn(async (entity) => entity as never),
    });
    const service = new TenantsService(repo);
    const result = await service.updateBranding('t1', { accentColorOverride: '#5c6bc0' });
    expect(result.accentColorOverride).toBe('5C6BC0');
    expect(result.effectiveAccentColor).toBe('5C6BC0');
  });

  it('updateBranding() rejects a malformed accent hex with InvalidColorFormatError', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...brandedRow }) as never) });
    const service = new TenantsService(repo);
    await expect(service.updateBranding('t1', { accentColorOverride: 'not-a-color' })).rejects.toThrow('Color must be a 6-digit hex value');
  });

  it('updateBranding() rejects an accent hex with insufficient contrast', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...brandedRow }) as never) });
    const service = new TenantsService(repo);
    // Very light gray fails contrast against the (default) white light-surface anchor.
    await expect(service.updateBranding('t1', { accentColorOverride: 'EEEEEE' })).rejects.toThrow(/contrast ratio/);
  });

  it('updateBranding() clears an override back to the platform default when accentColorOverride is null', async () => {
    const repo = createFakeRepo({
      findById: vi.fn(async () => ({ ...brandedRow, accentColorOverride: '112233' }) as never),
      save: vi.fn(async (entity) => entity as never),
    });
    const service = new TenantsService(repo);
    const result = await service.updateBranding('t1', { accentColorOverride: null });
    expect(result.accentColorOverride).toBeNull();
    expect(result.effectiveAccentColor).toBe('5C6BC0');
  });

  it('updateBranding() leaves accentColorOverride unchanged when the field is omitted (undefined)', async () => {
    const repo = createFakeRepo({
      findById: vi.fn(async () => ({ ...brandedRow, accentColorOverride: '112233' }) as never),
      save: vi.fn(async (entity) => entity as never),
    });
    const service = new TenantsService(repo);
    const result = await service.updateBranding('t1', { logoUrl: 'https://example.com/logo.png' });
    expect(result.accentColorOverride).toBe('112233');
    expect(result.logoUrl).toBe('https://example.com/logo.png');
  });
});
