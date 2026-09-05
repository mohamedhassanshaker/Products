import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { createTenantGuardExtension } from './tenant-guard.extension';
import { TenantContext } from '../tenancy/tenant-context';

/**
 * Prisma 7 client (pg adapter) with the tenantGuard extension applied.
 * Repositories use `db`; system jobs use `withBypass`.
 */
/**
 * Concrete-argument helper so TS resolves `$extends`'s generic overload to a
 * real delegate-typed client instead of collapsing to `unknown` (the failure
 * mode of writing `ReturnType<PrismaClient['$extends']>` directly).
 * @param client - Base Prisma client
 */
function withTenantGuard(client: PrismaClient) {
  return client.$extends(createTenantGuardExtension());
}

/** Prisma client extended with the tenantGuard query extension. */
type ExtendedPrismaClient = ReturnType<typeof withTenantGuard>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly base: PrismaClient;
  /** Extended client — the only Prisma surface application code should use. */
  readonly db: ExtendedPrismaClient;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is required');
    }
    const adapter = new PrismaPg({ connectionString: url });
    this.base = new PrismaClient({ adapter });
    this.db = withTenantGuard(this.base);
  }

  /**
   * Opens the pool. Failures propagate so the process does not serve traffic
   * without a database.
   */
  async onModuleInit(): Promise<void> {
    await this.base.$connect();
  }

  /** Closes the pool on shutdown. */
  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }

  /**
   * Runs `fn` with tenantGuard disabled (seed, tenant-create side effects,
   * idempotency store).
   *
   * **Correctness note (found live, Phase 7 dispatch):** Prisma 7's extended
   * client returns a *lazy* thenable from every model call (`db.session
   * .findUnique(...)` does nothing until `.then()`/`await` actually drives
   * it) — the tenantGuard extension's `$allOperations` only runs at that
   * later `.then()` point, not when the call is made. `AsyncLocalStorage`
   * only ties an async continuation to the active store if that
   * continuation is *created* while the store is synchronously active; a
   * bare `return fn()` here returns the lazy promise to the caller, whose
   * own `await` (outside this method's call frame) is what actually invokes
   * `.then()` — by then `TenantContext.run`'s dynamic extent has already
   * ended, so the guard sees no bypass and throws `TenantScopeViolationError`
   * even though the caller genuinely asked to bypass. Every prior unit test
   * for this method used a `fn` that was itself an `async () => {...}`
   * function (eagerly starts executing, and its body's `expect(...)` calls
   * run synchronously inside `run()`), which structurally cannot reproduce
   * this — only a real lazy Prisma call (or an equivalent deferred
   * thenable) exposes it, which is exactly what a live Postgres run
   * (this dispatch's own end-to-end verification) surfaced. Fixed by
   * chaining `.then()` onto `fn()`'s result *inside* the `run()` callback,
   * so the resulting continuation is created while the ALS store is active.
   * @param fn - Work that already specifies tenant_id or is not tenant-scoped
   */
  withBypass<T>(fn: () => Promise<T>): Promise<T> {
    const current = TenantContext.get();
    const scope = { tenantId: current?.tenantId ?? null, bypass: true };
    return new Promise<T>((resolve, reject) => {
      TenantContext.run(scope, () => {
        fn().then(resolve, reject);
      });
    });
  }

  /**
   * Interactive transaction on the extended client, always bypassed so the
   * caller is responsible for writing tenant_id on every row.
   * @param fn - Transactional work
   */
  async transaction<T>(fn: (tx: PrismaService['db']) => Promise<T>): Promise<T> {
    return this.withBypass(() =>
      // Prisma 7 interactive transaction on the base client; extension methods
      // are not required inside the transaction because we bypass the guard.
      this.base.$transaction(async (tx) => fn(tx as unknown as PrismaService['db'])),
    );
  }

  // Convenience delegates used by interceptors that should not import generated types.
  get idempotencyRecord() {
    return this.db.idempotencyRecord;
  }
}
