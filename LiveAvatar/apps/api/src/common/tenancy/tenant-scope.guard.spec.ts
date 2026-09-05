import { TenantScopeGuard } from './tenant-scope.guard';

function makeContext(params: Record<string, string>) {
  const req: Record<string, unknown> = { params };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    _req: req,
  } as { switchToHttp: () => { getRequest: () => Record<string, unknown> }; _req: Record<string, unknown> };
}

describe('TenantScopeGuard', () => {
  const guard = new TenantScopeGuard();

  it('always allows the request', () => {
    expect(guard.canActivate(makeContext({ id: 'tenant-1' }) as never)).toBe(true);
  });

  it('reads tenantId from :id', () => {
    const ctx = makeContext({ id: 'tenant-1' });
    guard.canActivate(ctx as never);
    expect(ctx._req.tenantId).toBe('tenant-1');
  });

  it('falls back to :tenantId when :id is absent', () => {
    const ctx = makeContext({ tenantId: 'tenant-2' });
    guard.canActivate(ctx as never);
    expect(ctx._req.tenantId).toBe('tenant-2');
  });

  it('sets tenantId to null when neither param is present', () => {
    const ctx = makeContext({});
    guard.canActivate(ctx as never);
    expect(ctx._req.tenantId).toBeNull();
  });
});
