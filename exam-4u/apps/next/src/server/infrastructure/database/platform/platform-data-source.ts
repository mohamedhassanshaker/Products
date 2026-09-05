import { DataSource } from 'typeorm';
import type { EnvVars } from '@/server/config';
import { PLATFORM_ENTITIES } from './entities';
import { PLATFORM_MIGRATIONS } from '../migrations/platform';

/**
 * Builds (but does not `initialize()`) the single platform `DataSource` — ported pattern from
 * `legacy/api/src/infrastructure/database/platform/platform-data-source.ts`.
 *
 * Phase 0 shipped this with empty `entities`/`migrations` (connect-and-prove only). This dispatch
 * (migration plan Phase 1, sub-slice 1a — "identity/tenancy foundation") is the first to populate
 * both, exactly the way the legacy factory's own doc comment describes each phase incrementally
 * appending its entities/migrations — see `./entities/index.ts` and `../migrations/platform/index.ts`
 * for what's included this dispatch and what's deliberately deferred.
 *
 * `synchronize`/`migrationsRun` are hard-coded `false` unconditionally (belt-and-braces, mirroring
 * the legacy factory) — schema drift must only ever happen through reviewed migrations, never
 * TypeORM's own auto-sync, in every environment.
 *
 * @param env Validated env vars (from `server/config`'s barrel) — never reads `process.env` itself.
 * @throws Error if `env.DB_SYNCHRONIZE` is ever `true` (defense in depth; `env.schema.ts`'s own
 *   production/staging assertion already refuses to boot with it set in a deployed environment).
 */
export function createPlatformDataSource(env: EnvVars): DataSource {
  if (env.DB_SYNCHRONIZE) {
    throw new Error(
      'TypeORM synchronize must never be enabled — refusing to build a DataSource (docs/plans/nextjs-rewrite-phase0-plan.md).',
    );
  }
  return new DataSource({
    type: 'mysql',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_PLATFORM_SCHEMA,
    charset: 'utf8mb4',
    poolSize: env.DB_PLATFORM_POOL_MAX,
    entities: PLATFORM_ENTITIES,
    migrations: PLATFORM_MIGRATIONS,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: {
      // Survives brief MySQL restarts without the whole process needing to restart.
      enableKeepAlive: true,
      connectTimeout: 10_000,
    },
  });
}
