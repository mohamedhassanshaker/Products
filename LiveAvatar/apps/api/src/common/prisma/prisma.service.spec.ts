import { TenantContext } from '../tenancy/tenant-context';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  const prevUrl = process.env.DATABASE_URL;

  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
  });

  afterAll(() => {
    process.env.DATABASE_URL = prevUrl;
  });

  it('throws at construction when DATABASE_URL is missing', () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(() => new PrismaService()).toThrow(/DATABASE_URL/);
    process.env.DATABASE_URL = saved;
  });

  it('exposes an extended db client with the tenantGuard extension applied', () => {
    const service = new PrismaService();
    expect(service.db).toBeDefined();
    expect(typeof service.db.tenant.findMany).toBe('function');
  });

  it('withBypass runs the callback inside a bypassed tenant scope', async () => {
    const service = new PrismaService();
    const result = await service.withBypass(async () => {
      expect(TenantContext.isBypassed()).toBe(true);
      return 'ok';
    });
    expect(result).toBe('ok');
  });

  it('withBypass preserves the current tenantId while bypassing', async () => {
    const service = new PrismaService();
    await TenantContext.run({ tenantId: 'tenant-1', bypass: false }, () =>
      service.withBypass(async () => {
        expect(TenantContext.get()).toEqual({ tenantId: 'tenant-1', bypass: true });
      }),
    );
  });

  /**
   * Regression test for a real bug found live (Phase 7 dispatch, against a
   * real Postgres): every prior test here passed `fn` as a genuine
   * `async () => {...}` function, which starts executing (and reads
   * `TenantContext`) *synchronously* the instant it's called — a shape that
   * structurally cannot reproduce the bug, since the ALS store is still on
   * the call stack at that point regardless of how `withBypass` is written.
   * Prisma 7's extended client instead returns a **lazy thenable** — calling
   * `db.session.findUnique(...)` does nothing until something actually calls
   * `.then()` on it, and the tenantGuard extension's check only runs at that
   * later point. This test's `fakeLazyPrismaCall` reproduces that exact
   * shape: `fn()` returns an object whose `.then()` is only invoked well
   * after `fn()` itself has returned, simulating the real-world gap between
   * "call the query method" and "the query engine actually dispatches it."
   * A naive `withBypass` implementation (`return TenantContext.run(scope,
   * fn)`) passes every other test in this file yet fails this one, because
   * `run()`'s dynamic extent has already ended by the time `.then()` fires.
   */
  it('withBypass stays bypassed even when fn returns a lazy thenable whose work starts after fn() itself returns', async () => {
    const service = new PrismaService();
    let observedBypass: boolean | undefined;

    function fakeLazyPrismaCall(): PromiseLike<string> {
      return {
        then(onFulfilled) {
          // Simulates the query engine's real dispatch happening on a later
          // microtask/macrotask turn, not synchronously inside the caller.
          return Promise.resolve().then(() => {
            observedBypass = TenantContext.isBypassed();
            return onFulfilled?.('ok');
          });
        },
      } as PromiseLike<string>;
    }

    const result = await service.withBypass(() => fakeLazyPrismaCall() as unknown as Promise<string>);

    expect(observedBypass).toBe(true);
    expect(result).toBe('ok');
  });

  it('idempotencyRecord getter delegates to db.idempotencyRecord', () => {
    const service = new PrismaService();
    expect(service.idempotencyRecord).toBe(service.db.idempotencyRecord);
  });

  it('transaction delegates to the base client transaction under bypass', async () => {
    const service = new PrismaService();
    const fakeTx = { tenant: {} };
    const base = (service as unknown as { base: { $transaction: jest.Mock } }).base;
    base.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(fakeTx));
    const result = await service.transaction(async (tx) => {
      expect(TenantContext.isBypassed()).toBe(true);
      return tx;
    });
    expect(result).toBe(fakeTx);
    expect(base.$transaction).toHaveBeenCalledTimes(1);
  });
});
