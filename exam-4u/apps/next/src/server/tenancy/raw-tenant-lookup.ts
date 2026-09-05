import mysql from 'mysql2/promise';
import type { TenantStatus } from '@examland/contracts';
import type { EnvVars } from '@/server/config';
import type { ResolvedTenant } from '@/server/platform/tenants';

/**
 * Deliberately entity-free, raw-SQL-only platform-tenant lookup — the **only** thing `middleware.ts`
 * (via `resolveTenantForRequest`) is ever allowed to touch.
 *
 * **Why this exists (a real bug found by actually running the built app, not assumed from a pattern)**:
 * Next.js always compiles `middleware.ts` as its own, fully separate webpack bundle
 * (`.next/server/middleware.js`), independent from every Route Handler's shared server bundle
 * (`.next/server/chunks/*.js`) — this is structural to how Next.js supports middleware potentially
 * running on the Edge runtime, not a build-config choice this app can opt out of. TypeORM's
 * `DataSource.getRepository(EntityClass)` looks up an entity's metadata by **reference equality** on
 * the entity *class object* itself, not by its `@Entity({name: ...})` string name. Because webpack
 * duplicates every module `middleware.ts` transitively imports into its own separate bundle, the
 * `TenantEntity`/`PlatformAdminEntity`/etc. class objects **inside `middleware.js` are different
 * objects at runtime** than the ones bundled into the shared route-handler chunks — even though both
 * originate from the identical source file. The platform `DataSource` singleton
 * (`getPlatformDataSource()`, cached on `globalThis`, correctly shared as a plain object reference
 * across bundles) registers its `EntityMetadata` map against whichever bundle's entity classes were
 * passed to `entities: [...]` at construction time — i.e., **whichever code path calls
 * `getPlatformDataSource()` first**. Since `middleware.ts` runs before every matched request's Route
 * Handler, it is very likely to be that first caller — and once it is, `dataSource.getRepository(...)`
 * calls from the **real** (shared, non-middleware) bundle group start failing with TypeORM's
 * `EntityMetadataNotFoundError` (observed verbatim as `"No metadata for '<mangled-class-name>' was
 * found."` against a real `next start` boot + real `curl -H "Host: ..."` request during this
 * dispatch's own exit-gate verification) — silently breaking **every** platform-entity-backed route in
 * the whole running process, not just tenant resolution.
 *
 * The fix is structural, not a workaround: `middleware.ts`'s tenant lookup must never construct or
 * touch the shared, entity-based platform `DataSource` at all. This module gives it a dedicated,
 * lightweight, connection-pooled raw `mysql2` client instead — no entity classes, no metadata, so no
 * bundle-identity mismatch is even possible. Matches this app's own existing precedent
 * (`ensure-schema-exists.ts`'s identical "raw connection for a narrow, non-entity operation" pattern).
 */

interface RawTenantRow {
  id: string;
  subdomain_slug: string;
  schema_name: string;
  status: TenantStatus;
}

declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandTenantLookupPool: mysql.Pool | undefined;
}

/** A small, dedicated connection pool — separate from both the platform `DataSource`'s pool and every
 * tenant `DataSource`'s pool, and, critically, from any TypeORM entity metadata whatsoever. Cached on
 * `globalThis` for the same Next.js dev-hot-reload reason every other singleton in this app is. */
function getTenantLookupPool(env: EnvVars): mysql.Pool {
  if (!globalThis.__examlandTenantLookupPool) {
    globalThis.__examlandTenantLookupPool = mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_PLATFORM_SCHEMA,
      charset: 'utf8mb4',
      connectionLimit: 5,
    });
  }
  return globalThis.__examlandTenantLookupPool;
}

/**
 * Raw-SQL equivalent of `PlatformTenantRepository.findResolvableBySlug` (identical query/semantics —
 * non-soft-deleted tenant by slug) — the only difference is this never touches TypeORM's entity
 * metadata. Satisfies the exact same narrow shape `resolveTenantBySlug`'s `TenantResolutionDeps.repo`
 * expects, so `middleware.ts`'s real production path and this module's own unit tests (which inject a
 * fake matching this same shape) exercise identical branching logic either way.
 */
export async function findResolvableTenantBySlugRaw(slug: string, env: EnvVars): Promise<ResolvedTenant | null> {
  const pool = getTenantLookupPool(env);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT id, subdomain_slug, schema_name, status FROM tenant WHERE subdomain_slug = ? AND deleted_at IS NULL LIMIT 1',
    [slug],
  );
  const row = rows[0] as RawTenantRow | undefined;
  if (!row) return null;
  return { id: row.id, subdomainSlug: row.subdomain_slug, schemaName: row.schema_name, status: row.status };
}
