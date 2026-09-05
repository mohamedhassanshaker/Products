import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request tenant scope carried through Prisma and guards. */
export interface TenantScope {
  tenantId: string | null;
  bypass: boolean;
}

const storage = new AsyncLocalStorage<TenantScope>();

/**
 * AsyncLocalStorage holder for the current tenant (FR-TENANT-5).
 */
export class TenantContext {
  /**
   * Runs `fn` inside a tenant scope.
   * @param scope - Tenant id and optional guard bypass
   * @param fn - Work to run
   */
  static run<T>(scope: TenantScope, fn: () => T): T {
    return storage.run(scope, fn);
  }

  /** @returns Current scope, or undefined outside a request */
  static get(): TenantScope | undefined {
    return storage.getStore();
  }

  /** @returns Whether tenantGuard should skip enforcement */
  static isBypassed(): boolean {
    return storage.getStore()?.bypass === true;
  }
}
