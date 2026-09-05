import { TenantContext } from '../tenancy/tenant-context';
import { TenantScopeViolationError } from '../errors/app-error';
import { createTenantGuardExtension } from './tenant-guard.extension';

/**
 * `Prisma.defineExtension(args)` returns `client => client.$extends(args)`
 * for a plain (non-function) args object — not the args object itself. A
 * fake client whose `$extends` returns its argument unwraps back to the raw
 * extension definition, from which the `$allOperations` handler under
 * `query.$allModels` can be invoked directly with a fake
 * `{model, operation, args, query}` tuple. This is the standard way to unit
 * test a Prisma client extension without a real database.
 */
function getHandler() {
  const applyExtension = createTenantGuardExtension() as unknown as (client: unknown) => unknown;
  const fakeClient = { $extends: (args: unknown) => args };
  const ext = applyExtension(fakeClient) as {
    query: { $allModels: { $allOperations: (input: unknown) => unknown } };
  };
  return ext.query.$allModels.$allOperations;
}

describe('tenantGuard Prisma extension', () => {
  const handler = getHandler();
  const passthroughQuery = jest.fn((args: unknown) => Promise.resolve(args));

  afterEach(() => passthroughQuery.mockClear());

  it('passes through untouched for a non-tenant-scoped model', async () => {
    await handler({ model: 'Tenant', operation: 'findMany', args: { where: {} }, query: passthroughQuery });
    expect(passthroughQuery).toHaveBeenCalledWith({ where: {} });
  });

  it('passes through untouched when the context is bypassed', async () => {
    await TenantContext.run({ tenantId: null, bypass: true }, () =>
      handler({ model: 'Session', operation: 'findMany', args: { where: {} }, query: passthroughQuery }),
    );
    expect(passthroughQuery).toHaveBeenCalledWith({ where: {} });
  });

  it('injects tenantId into a create when scoped', async () => {
    await TenantContext.run({ tenantId: 'tenant-1', bypass: false }, () =>
      handler({
        model: 'Session',
        operation: 'create',
        args: { data: { roomName: 'x' } },
        query: passthroughQuery,
      }),
    );
    expect(passthroughQuery).toHaveBeenCalledWith({ data: { roomName: 'x', tenantId: 'tenant-1' } });
  });

  it('does not override an explicit tenantId on create', async () => {
    await TenantContext.run({ tenantId: 'tenant-1', bypass: false }, () =>
      handler({
        model: 'Session',
        operation: 'create',
        args: { data: { tenantId: 'explicit' } },
        query: passthroughQuery,
      }),
    );
    expect(passthroughQuery).toHaveBeenCalledWith({ data: { tenantId: 'explicit' } });
  });

  it('throws TenantScopeViolationError on create with no scope and no explicit tenantId', async () => {
    await TenantContext.run({ tenantId: null, bypass: false }, () =>
      expect(
        handler({ model: 'Session', operation: 'create', args: { data: {} }, query: passthroughQuery }),
      ).rejects.toBeInstanceOf(TenantScopeViolationError),
    );
  });

  it('createMany: throws when any row lacks tenantId and no scope is set', async () => {
    await TenantContext.run({ tenantId: null, bypass: false }, () =>
      expect(
        handler({
          model: 'Session',
          operation: 'createMany',
          args: { data: [{ tenantId: 'a' }, {}] },
          query: passthroughQuery,
        }),
      ).rejects.toBeInstanceOf(TenantScopeViolationError),
    );
  });

  it('createMany: passes through when scoped', async () => {
    await TenantContext.run({ tenantId: 'tenant-1', bypass: false }, () =>
      handler({
        model: 'Session',
        operation: 'createMany',
        args: { data: [{}] },
        query: passthroughQuery,
      }),
    );
    expect(passthroughQuery).toHaveBeenCalled();
  });

  it('createMany: passes through a single-row data object unchanged', async () => {
    await TenantContext.run({ tenantId: null, bypass: false }, () =>
      handler({
        model: 'Session',
        operation: 'createMany',
        args: { data: { tenantId: 'a' } },
        query: passthroughQuery,
      }),
    );
    expect(passthroughQuery).toHaveBeenCalled();
  });

  it('injects tenantId into a find where-clause when scoped', async () => {
    await TenantContext.run({ tenantId: 'tenant-1', bypass: false }, () =>
      handler({ model: 'Session', operation: 'findMany', args: { where: {} }, query: passthroughQuery }),
    );
    expect(passthroughQuery).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1' } });
  });

  it('does not double-inject when the where already has tenantId', async () => {
    await TenantContext.run({ tenantId: 'tenant-1', bypass: false }, () =>
      handler({
        model: 'Session',
        operation: 'findMany',
        args: { where: { tenantId: 'tenant-1' } },
        query: passthroughQuery,
      }),
    );
    expect(passthroughQuery).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1' } });
  });

  it('recognizes tenantId nested in an AND clause', async () => {
    await TenantContext.run({ tenantId: 'tenant-1', bypass: false }, () =>
      handler({
        model: 'Session',
        operation: 'findMany',
        args: { where: { AND: [{ tenantId: 'tenant-1' }] } },
        query: passthroughQuery,
      }),
    );
    expect(passthroughQuery).toHaveBeenCalledWith({ where: { AND: [{ tenantId: 'tenant-1' }] } });
  });

  it('throws on an unscoped find with no tenant context (server defect)', async () => {
    await expect(
      handler({ model: 'Session', operation: 'findMany', args: { where: {} }, query: passthroughQuery }),
    ).rejects.toBeInstanceOf(TenantScopeViolationError);
  });

  it('throws on an unscoped write op (update) with no tenant context', async () => {
    await expect(
      handler({ model: 'Session', operation: 'update', args: { where: {} }, query: passthroughQuery }),
    ).rejects.toBeInstanceOf(TenantScopeViolationError);
  });

  it('throws on count/aggregate without a where clause when unscoped', async () => {
    await expect(
      handler({ model: 'Session', operation: 'count', args: {}, query: passthroughQuery }),
    ).rejects.toBeInstanceOf(TenantScopeViolationError);
  });
});
