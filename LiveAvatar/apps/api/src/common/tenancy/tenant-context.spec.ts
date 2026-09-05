import { TenantContext } from './tenant-context';

describe('TenantContext', () => {
  it('returns undefined outside a run scope', () => {
    expect(TenantContext.get()).toBeUndefined();
    expect(TenantContext.isBypassed()).toBe(false);
  });

  it('exposes the scope set by run()', () => {
    TenantContext.run({ tenantId: 'tenant-1', bypass: false }, () => {
      expect(TenantContext.get()).toEqual({ tenantId: 'tenant-1', bypass: false });
      expect(TenantContext.isBypassed()).toBe(false);
    });
  });

  it('reports bypass:true inside a bypassed scope', () => {
    TenantContext.run({ tenantId: null, bypass: true }, () => {
      expect(TenantContext.isBypassed()).toBe(true);
    });
  });

  it('isolates nested scopes', () => {
    TenantContext.run({ tenantId: 'outer', bypass: false }, () => {
      TenantContext.run({ tenantId: 'inner', bypass: true }, () => {
        expect(TenantContext.get()?.tenantId).toBe('inner');
      });
      expect(TenantContext.get()?.tenantId).toBe('outer');
    });
  });

  it('returns the value produced by run()', () => {
    const result = TenantContext.run({ tenantId: null, bypass: false }, () => 42);
    expect(result).toBe(42);
  });
});
