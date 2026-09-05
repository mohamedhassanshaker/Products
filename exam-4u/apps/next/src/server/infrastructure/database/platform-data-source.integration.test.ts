import { afterAll, describe, expect, it } from 'vitest';
import { getPlatformDataSource } from './index';

/**
 * Real-connection integration test (migration plan exit gate: "Confirm the TypeORM platform
 * DataSource genuinely connects to the real MySQL container — a real connection test, not a mocked
 * one"). Deliberately NOT mocked — exercises `getEnv()` → `createPlatformDataSource()` →
 * `DataSource.initialize()` against the actual, already-running MySQL instance.
 *
 * Requires `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_PLATFORM_SCHEMA` to point at a reachable MySQL
 * server with that schema already created (docs/plans/nextjs-rewrite-phase0-plan.md's "Deviation"
 * note: run against the already-running `exam-4u-mysql-1` container — same host port/credentials as
 * `docker/docker-compose.dev.yml`'s own `mysql` service). Run via:
 *
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform \
 *     npm run test -w apps/next -- platform-data-source.integration
 */
describe('getPlatformDataSource (real MySQL connection)', () => {
  afterAll(async () => {
    const ds = await getPlatformDataSource();
    await ds.destroy();
  });

  it('initializes and round-trips a real SELECT 1 against the platform schema', async () => {
    const ds = await getPlatformDataSource();
    expect(ds.isInitialized).toBe(true);
    const rows = await ds.query('SELECT 1 AS ok');
    // mysql2 returns a literal-constant column as a string, not a number (a real driver quirk,
    // not a mock) — assert loosely on value rather than type for this proof-of-connectivity check.
    expect(String(rows[0].ok)).toBe('1');
  });

  it('caches the DataSource as a singleton (globalThis-backed, dev-hot-reload-safe)', async () => {
    const first = await getPlatformDataSource();
    const second = await getPlatformDataSource();
    expect(first).toBe(second);
  });
});
