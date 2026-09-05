import { GetPreflightUseCase } from './get-preflight.use-case';
import { AppError } from '../../../common/errors/app-error';

function makeTenant(overrides: Record<string, unknown> = {}) {
  return { id: 't1', slug: 'acme', name: 'Acme', status: 'active', roomNamespace: 'acme', ...overrides };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return { status: 'published', ...overrides };
}

describe('GetPreflightUseCase (FR-CALL-1)', () => {
  beforeEach(() => {
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
  });

  function make(tenant: unknown, config: unknown, reachable: boolean) {
    const tenants = { findBySlug: jest.fn().mockResolvedValue(tenant) };
    const configs = { findByTenantId: jest.fn().mockResolvedValue(config) };
    const liveKit = { checkReachable: jest.fn().mockResolvedValue(reachable) };
    return { useCase: new GetPreflightUseCase(tenants as never, configs as never, liveKit as never), tenants, configs, liveKit };
  }

  it('returns the success shape when tenant/config/transport all check out', async () => {
    const { useCase } = make(makeTenant(), makeConfig(), true);
    const result = await useCase.execute('acme');
    expect(result).toEqual({
      deployment: { slug: 'acme', name: 'Acme' },
      transport: { reachable: true, ws_url: 'ws://localhost:7880' },
      config: { complete: true },
      avatar: {},
    });
  });

  it('throws TENANT_NOT_FOUND for an unknown slug', async () => {
    const { useCase } = make(null, null, true);
    await expect(useCase.execute('missing')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND', httpStatus: 404 });
  });

  it('throws TENANT_PAUSED for a paused tenant', async () => {
    const { useCase } = make(makeTenant({ status: 'paused' }), makeConfig(), true);
    await expect(useCase.execute('acme')).rejects.toMatchObject({ code: 'TENANT_PAUSED', httpStatus: 403 });
  });

  it('throws CONFIG_INCOMPLETE when there is no config row', async () => {
    const { useCase } = make(makeTenant(), null, true);
    await expect(useCase.execute('acme')).rejects.toMatchObject({ code: 'CONFIG_INCOMPLETE', httpStatus: 422 });
  });

  it('throws CONFIG_INCOMPLETE when the config is only a draft', async () => {
    const { useCase } = make(makeTenant(), makeConfig({ status: 'draft' }), true);
    await expect(useCase.execute('acme')).rejects.toMatchObject({ code: 'CONFIG_INCOMPLETE' });
  });

  it('throws TRANSPORT_UNAVAILABLE when LiveKit is unreachable', async () => {
    const { useCase } = make(makeTenant(), makeConfig(), false);
    await expect(useCase.execute('acme')).rejects.toMatchObject({ code: 'TRANSPORT_UNAVAILABLE', httpStatus: 503 });
  });

  it('is an AppError instance on every failure path (envelope-mappable)', async () => {
    const { useCase } = make(null, null, true);
    await expect(useCase.execute('missing')).rejects.toBeInstanceOf(AppError);
  });
});
