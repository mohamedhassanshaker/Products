import type { DataSource } from 'typeorm';
import { InvalidTenantStateError } from '@/server/platform/tenants';

/** How long a caller will wait to acquire the per-tenant provisioning lock before giving up (MySQL
 * `GET_LOCK`'s own timeout parameter, in seconds) — ported verbatim from
 * `legacy/api/src/tenancy/provisioning/tenant-provisioning-lock.service.ts`. Generous enough to cover
 * a normal provisioning run's step sequence. */
const LOCK_TIMEOUT_SECONDS = 30;

/**
 * Serializes `TenantProvisioningService`'s per-tenant step-driving via a MySQL named lock
 * (`GET_LOCK`/`RELEASE_LOCK`) — ported verbatim (logic unchanged) from
 * `legacy/api/src/tenancy/provisioning/tenant-provisioning-lock.service.ts`. Closes the concurrency
 * defect legacy's own QA pass found: two concurrent `retry()` calls (or a `retry()` racing a
 * still-in-flight `provisionNewTenant()`) for the same tenant could otherwise let a slow, ultimately-
 * failing concurrent retry overwrite a fast, successful retry's `Active` status back to `Failed` even
 * though every step genuinely completed.
 *
 * A `GET_LOCK` scoped to a dedicated `QueryRunner` connection, released in a `finally` block
 * regardless of outcome, so a crash mid-provisioning still releases the lock when that connection is
 * torn down (MySQL auto-releases a session's named locks on disconnect, a defense-in-depth backstop
 * on top of the explicit `RELEASE_LOCK`).
 */
export class TenantProvisioningLockService {
  constructor(private readonly dataSource: DataSource) {}

  /** Runs `fn` while holding the named lock for `tenantId`. Waits up to {@link LOCK_TIMEOUT_SECONDS}
   * to acquire it before throwing.
   *
   * @throws {InvalidTenantStateError} if the lock could not be acquired within the timeout (another
   *   provisioning run is genuinely still in progress for this tenant).
   */
  async withLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const lockName = `tenant_provisioning:${tenantId}`;
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows: Array<{ acquired: number | string | null }> = await runner.query(
        'SELECT GET_LOCK(?, ?) AS acquired',
        [lockName, LOCK_TIMEOUT_SECONDS],
      );
      const acquired = rows[0]?.acquired;
      if (acquired !== 1 && acquired !== '1') {
        // 0 = timed out waiting; NULL = an internal MySQL error acquiring/checking the lock. Both
        // collapse to the same client-visible outcome: "try again shortly", not a hard failure.
        throw new InvalidTenantStateError(
          'Provisioning is already in progress for this tenant; please try again shortly.',
        );
      }
      return await fn();
    } finally {
      try {
        await runner.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } catch {
        // Best-effort — the session-scoped auto-release backstop (see class doc comment) covers this.
      }
      await runner.release();
    }
  }
}
